import { watch as fsWatch, statSync, type FSWatcher } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { Syncer } from './syncer.js'
import type { SessionSource } from '../types.js'
import { detectSessionSource, getSessionRoots } from './source-paths.js'
import { normalizeOpenCodeWatchPath } from '../parsers/opencode.js'

export type WatcherEvent = 'new-sessions' | 'error'

export interface WatcherEventDataMap {
  'new-sessions': { count: number }
  'error': { error: Error; root?: string }
}

export type WatcherEventData = WatcherEventDataMap[WatcherEvent]

export type WatcherEventCallback<E extends WatcherEvent = WatcherEvent> = (
  event: E,
  data: WatcherEventDataMap[E],
) => void

export interface SpoolWatcherOptions {
  /** Milliseconds of inactivity before considering a file's writes finished. */
  stabilityMs?: number
  /** Poll interval while waiting for size/mtime to settle. */
  pollMs?: number
  /** Window over which new-session events coalesce into a single emission. */
  flushMs?: number
  /** Dependency injection for tests — defaults to node:fs watch. */
  watchFn?: typeof fsWatch
}

interface PendingEntry {
  timer: ReturnType<typeof setTimeout>
  lastSize: number
  lastMtimeMs: number
}

const DEFAULT_STABILITY_MS = 2000
const DEFAULT_POLL_MS = 200
const DEFAULT_FLUSH_MS = 500

export class SpoolWatcher {
  private watchers: FSWatcher[] = []
  private listeners: Map<WatcherEvent, WatcherEventCallback[]> = new Map()
  private pending: Map<string, PendingEntry> = new Map()
  private pendingNew = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private sourceRoots: Record<SessionSource, string[]> = { claude: [], codex: [], gemini: [], antigravity: [], opencode: [] }
  private stopped = false
  private readonly stabilityMs: number
  private readonly pollMs: number
  private readonly flushMs: number
  private readonly watchFn: typeof fsWatch

  constructor(private syncer: Syncer, opts: SpoolWatcherOptions = {}) {
    this.stabilityMs = opts.stabilityMs ?? DEFAULT_STABILITY_MS
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS
    this.watchFn = opts.watchFn ?? fsWatch
  }

  start(): void {
    this.stopped = false
    this.sourceRoots = {
      claude: getSessionRoots('claude'),
      codex: getSessionRoots('codex'),
      gemini: getSessionRoots('gemini'),
      antigravity: getSessionRoots('antigravity'),
      opencode: getSessionRoots('opencode'),
    }
    const roots = [
      ...this.sourceRoots.claude,
      ...this.sourceRoots.codex,
      ...this.sourceRoots.gemini,
      ...this.sourceRoots.antigravity,
      ...this.sourceRoots.opencode,
    ]
    for (const root of roots) this.watchRoot(root)
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) {
      try { w.close() } catch { /* ignore */ }
    }
    this.watchers = []
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingNew = 0
  }

  on<E extends WatcherEvent>(event: E, cb: WatcherEventCallback<E>): void {
    const list = this.listeners.get(event) ?? []
    list.push(cb as WatcherEventCallback)
    this.listeners.set(event, list)
  }

  private watchRoot(root: string): void {
    let w: FSWatcher
    try {
      w = this.watchFn(root, { persistent: true, recursive: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      // Missing root is expected (e.g. user hasn't used Gemini CLI) — silently skip.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        this.emit('error', { error: err as Error, root })
      }
      return
    }

    w.on('change', (_eventType, filename) => {
      if (this.stopped || !filename) return
      // OpenCode commits land in opencode.db-wal; map sidecar writes to the main
      // DB so they aren't filtered out and trigger a re-index. Stability polling
      // then debounces on the (static) main file, settling once writes pause.
      const abs = normalizeOpenCodeWatchPath(resolvePath(root, filename.toString()))
      this.schedulePoll(abs)
    })

    w.on('error', (err) => {
      this.emit('error', { error: err as Error, root })
    })

    this.watchers.push(w)
  }

  private schedulePoll(filePath: string): void {
    // Only process files whose final path matches a configured source.
    // Prefilter here avoids noisy stat() on unrelated dir events.
    if (!detectSessionSource(filePath, this.sourceRoots)) {
      // Could still be a future session file in a new subdir — but detectSessionSource
      // already matches by suffix + root containment, so unrelated hits are rejected here.
      return
    }

    const existing = this.pending.get(filePath)
    if (existing) clearTimeout(existing.timer)

    const entry: PendingEntry = {
      lastSize: existing?.lastSize ?? -1,
      lastMtimeMs: existing?.lastMtimeMs ?? -1,
      timer: setTimeout(() => this.pollStability(filePath), this.stabilityMs),
    }
    this.pending.set(filePath, entry)
  }

  private pollStability(filePath: string): void {
    if (this.stopped) return
    const entry = this.pending.get(filePath)
    if (!entry) return

    let size: number
    let mtimeMs: number
    try {
      const s = statSync(filePath)
      if (!s.isFile()) {
        this.pending.delete(filePath)
        return
      }
      size = s.size
      mtimeMs = s.mtimeMs
    } catch {
      // File gone or transient error — drop.
      this.pending.delete(filePath)
      return
    }

    if (size === entry.lastSize && mtimeMs === entry.lastMtimeMs) {
      this.pending.delete(filePath)
      this.runSync(filePath)
      return
    }
    entry.lastSize = size
    entry.lastMtimeMs = mtimeMs
    entry.timer = setTimeout(() => this.pollStability(filePath), this.pollMs)
  }

  private runSync(filePath: string): void {
    // Decouple the sync call from the watcher event path so a slow or throwing
    // syncFile cannot stall event delivery or create unhandled rejections.
    queueMicrotask(() => {
      if (this.stopped) return
      const source = detectSessionSource(filePath, this.sourceRoots)
      if (!source) return
      let result: ReturnType<Syncer['syncFile']>
      try {
        result = this.syncer.syncFile(filePath, source)
      } catch (err) {
        this.emit('error', { error: err as Error })
        return
      }
      if (result === 'added' || result === 'updated') {
        this.pendingNew++
        if (this.flushTimer) clearTimeout(this.flushTimer)
        this.flushTimer = setTimeout(() => this.flushNew(), this.flushMs)
      }
    })
  }

  private flushNew(): void {
    this.flushTimer = null
    const count = this.pendingNew
    this.pendingNew = 0
    if (count > 0) this.emit('new-sessions', { count })
  }

  private emit<E extends WatcherEvent>(event: E, data: WatcherEventDataMap[E]): void {
    const list = this.listeners.get(event)
    if (!list) return
    for (const cb of list) {
      try { (cb as WatcherEventCallback<E>)(event, data) } catch { /* listener errors shouldn't break the watcher */ }
    }
  }
}
