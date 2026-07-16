import { afterEach, describe, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpoolWatcher, type WatcherEvent, type WatcherEventData } from './watcher.js'
import type { Syncer } from './syncer.js'
import type { SessionSource } from '../types.js'

const FAST = { stabilityMs: 40, pollMs: 15, flushMs: 40 } as const

const tempDirs: string[] = []
const runningWatchers: SpoolWatcher[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (runningWatchers.length > 0) runningWatchers.pop()?.stop()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoots() {
  const baseDir = mkdtempSync(join(tmpdir(), 'spool-watcher-'))
  tempDirs.push(baseDir)
  const claudeRoot = join(baseDir, 'claude', 'projects')
  const codexRoot = join(baseDir, 'codex', 'sessions')
  const geminiRoot = join(baseDir, 'gemini', 'tmp')
  const opencodeRoot = join(baseDir, 'opencode')
  const antigravityRoot = join(baseDir, 'antigravity')
  mkdirSync(join(claudeRoot, 'project-a'), { recursive: true })
  mkdirSync(join(codexRoot, '2026', '04', '20'), { recursive: true })
  mkdirSync(join(geminiRoot, 'workspace', 'chats'), { recursive: true })
  mkdirSync(opencodeRoot, { recursive: true })
  mkdirSync(antigravityRoot, { recursive: true })
  vi.stubEnv('SPOOL_CLAUDE_DIR', claudeRoot)
  vi.stubEnv('SPOOL_CODEX_DIR', codexRoot)
  vi.stubEnv('SPOOL_GEMINI_DIR', join(baseDir, 'gemini'))
  vi.stubEnv('SPOOL_ANTIGRAVITY_DIR', antigravityRoot)
  vi.stubEnv('SPOOL_OPENCODE_DIR', opencodeRoot)
  return { baseDir, claudeRoot, codexRoot, geminiRoot, antigravityRoot, opencodeRoot }
}

interface SyncCall { path: string; source: SessionSource }

function makeStubSyncer(opts: { result?: 'added' | 'updated' | 'skipped' | 'error' | ((p: string) => 'added' | 'updated' | 'skipped' | 'error'); throws?: Error } = {}) {
  const calls: SyncCall[] = []
  const syncer = {
    syncFile(path: string, source: SessionSource) {
      calls.push({ path, source })
      if (opts.throws) throw opts.throws
      if (typeof opts.result === 'function') return opts.result(path)
      return opts.result ?? 'added'
    },
  } as unknown as Syncer
  return { syncer, calls }
}

async function startWatcher(syncer: Syncer, extra: Partial<ConstructorParameters<typeof SpoolWatcher>[1]> = {}) {
  const w = new SpoolWatcher(syncer, { ...FAST, ...extra })
  runningWatchers.push(w)
  w.start()
  // macOS FSEvents (which backs fs.watch recursive) has a priming window
  // after the stream is scheduled on the runloop. Events that happen before
  // it is hot can be dropped. CI runners are slower than local machines, so
  // give it a generous margin here.
  await new Promise(r => setTimeout(r, process.platform === 'darwin' ? 500 : 150))
  return w
}

const waitFor = async (pred: () => boolean, timeoutMs = 2000, stepMs = 10) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise(r => setTimeout(r, stepMs))
  }
  throw new Error('waitFor: timed out')
}

describe('SpoolWatcher', () => {
  test('emits new-sessions and calls syncFile once when a session file is added', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer, calls } = makeStubSyncer({ result: 'added' })
    const events: Array<{ event: WatcherEvent; data: WatcherEventData }> = []
    const w = await startWatcher(syncer)
    w.on('new-sessions', (event, data) => { events.push({ event, data }) })

    const filePath = join(claudeRoot, 'project-a', 'abc.jsonl')
    writeFileSync(filePath, '{}\n')

    await waitFor(() => calls.length > 0)
    await waitFor(() => events.length > 0)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ path: filePath, source: 'claude' })
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('new-sessions')
    expect((events[0]?.data as { count: number }).count).toBe(1)
  })

  test('ignores non-session files', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer, calls } = makeStubSyncer()
    await startWatcher(syncer)

    writeFileSync(join(claudeRoot, 'project-a', 'notes.txt'), 'hi')
    writeFileSync(join(claudeRoot, 'project-a', 'rando.json'), '{}')

    await new Promise(r => setTimeout(r, FAST.stabilityMs * 4))
    expect(calls).toHaveLength(0)
  })

  test('debounces rapid writes to the same file — syncFile called once per stable window', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer, calls } = makeStubSyncer({ result: 'updated' })
    await startWatcher(syncer)

    const filePath = join(claudeRoot, 'project-a', 'live.jsonl')
    writeFileSync(filePath, '{"i":0}\n')
    for (let i = 1; i <= 8; i++) {
      await new Promise(r => setTimeout(r, 8))
      appendFileSync(filePath, `{"i":${i}}\n`)
    }

    await waitFor(() => calls.length >= 1)
    // Give any trailing events a chance to flush
    await new Promise(r => setTimeout(r, FAST.stabilityMs * 3))

    expect(calls.length).toBeGreaterThanOrEqual(1)
    // The main point: we coalesce — not 9 calls, one per write
    expect(calls.length).toBeLessThan(4)
    for (const c of calls) expect(c.path).toBe(filePath)
  })

  test('detects codex, gemini, and opencode sources', async () => {
    const { codexRoot, geminiRoot, opencodeRoot } = makeTempRoots()
    const { syncer, calls } = makeStubSyncer()
    await startWatcher(syncer)

    const codexFile = join(codexRoot, '2026', '04', '20', 'rollout.jsonl')
    const geminiFile = join(geminiRoot, 'workspace', 'chats', 'session-2026-04-20T00-00-deadbeef.json')
    const opencodeFile = join(opencodeRoot, 'opencode.db')
    writeFileSync(codexFile, '{}\n')
    writeFileSync(geminiFile, '{}')
    writeFileSync(opencodeFile, '')

    await waitFor(() => calls.length >= 3, 3000)

    const sources = new Set(calls.map(c => c.source))
    expect(sources.has('codex')).toBe(true)
    expect(sources.has('gemini')).toBe(true)
    expect(sources.has('opencode')).toBe(true)
  })

  test('maps an opencode.db-wal change event to a sync of opencode.db', async () => {
    const { opencodeRoot } = makeTempRoots()
    // pollStability stats the main DB, so it must exist on disk. WAL-mode commits
    // land in the -wal sidecar and may leave the main file's mtime unchanged —
    // the watcher must still map the sidecar event back to opencode.db and sync.
    const dbPath = join(opencodeRoot, 'opencode.db')
    writeFileSync(dbPath, '')

    const { syncer, calls } = makeStubSyncer()
    const emitters: Array<EventEmitter & { path: string }> = []
    const fakeWatch = (path: string) => {
      const ee = new EventEmitter() as EventEmitter & { path: string; close: () => void }
      ee.path = path
      ee.close = () => { /* noop */ }
      emitters.push(ee)
      return ee as unknown as import('node:fs').FSWatcher
    }
    const w = new SpoolWatcher(syncer, { ...FAST, watchFn: fakeWatch })
    runningWatchers.push(w)
    w.start()

    const ocWatcher = emitters.find(e => e.path === opencodeRoot)
    expect(ocWatcher).toBeDefined()
    ocWatcher!.emit('change', 'change', 'opencode.db-wal')

    await waitFor(() => calls.length > 0, 2000)
    expect(calls[0]).toEqual({ path: dbPath, source: 'opencode' })
  })

  test('coalesces many new-session events into a single count', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer, calls } = makeStubSyncer({ result: 'added' })
    const events: Array<WatcherEventData> = []
    const w = await startWatcher(syncer, { flushMs: 80 })
    w.on('new-sessions', (_event, data) => { events.push(data) })

    // Write into a directory that already exists at start() time to avoid
    // racing against FSEvents delivery of the mkdir event on macOS.
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(claudeRoot, 'project-a', `s${i}.jsonl`), '{}\n')
      await new Promise(r => setTimeout(r, 5))
    }

    await waitFor(() => calls.length >= 5, 5000)
    await waitFor(() => events.length >= 1, 3000)
    // Allow flush window to close
    await new Promise(r => setTimeout(r, 160))

    const totalCount = events.reduce((n, d) => n + ((d as { count: number }).count ?? 0), 0)
    expect(totalCount).toBe(5)
    // Expect events to coalesce, not one per file
    expect(events.length).toBeLessThanOrEqual(2)
  })

  test('stop() prevents any further syncFile calls and clears timers', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer, calls } = makeStubSyncer()
    const w = await startWatcher(syncer)

    w.stop()
    writeFileSync(join(claudeRoot, 'project-a', 'after-stop.jsonl'), '{}\n')
    await new Promise(r => setTimeout(r, FAST.stabilityMs * 4))
    expect(calls).toHaveLength(0)
  })

  test('does not throw when a session root does not exist', () => {
    vi.stubEnv('SPOOL_CLAUDE_DIR', join(tmpdir(), 'spool-watcher-nonexistent-' + Date.now()))
    vi.stubEnv('SPOOL_CODEX_DIR', join(tmpdir(), 'spool-watcher-nonexistent-' + Date.now() + '-b'))
    vi.stubEnv('SPOOL_GEMINI_DIR', join(tmpdir(), 'spool-watcher-nonexistent-' + Date.now() + '-g'))
    vi.stubEnv('SPOOL_OPENCODE_DIR', join(tmpdir(), 'spool-watcher-nonexistent-' + Date.now() + '-o'))
    const { syncer } = makeStubSyncer()
    const w = new SpoolWatcher(syncer, FAST)
    runningWatchers.push(w)
    expect(() => w.start()).not.toThrow()
  })

  test('captures errors from underlying watchers instead of surfacing as unhandled rejections', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer } = makeStubSyncer()
    const fakeWatchers: EventEmitter[] = []
    const fakeWatch = (path: string) => {
      const ee = new EventEmitter() as EventEmitter & { close: () => void }
      ;(ee as unknown as { path: string }).path = path
      ee.close = () => { /* noop */ }
      fakeWatchers.push(ee)
      return ee as unknown as import('node:fs').FSWatcher
    }
    const errors: Array<{ root?: string; error: Error }> = []
    const w = new SpoolWatcher(syncer, { ...FAST, watchFn: fakeWatch })
    runningWatchers.push(w)
    w.on('error', (_event, data) => {
      errors.push({ root: (data as { root?: string }).root, error: (data as { error: Error }).error })
    })
    w.start()

    expect(fakeWatchers.length).toBeGreaterThan(0)
    const err = Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' })
    fakeWatchers[0]!.emit('error', err)

    await waitFor(() => errors.length > 0)
    expect(errors[0]?.error.message).toContain('EMFILE')
    // Ensure other watchers still alive — we can still emit and capture them
    if (fakeWatchers.length > 1) {
      fakeWatchers[1]!.emit('error', new Error('second'))
      await waitFor(() => errors.length >= 2)
    }
    // Sanity — no unhandled rejections; process still alive
    expect(claudeRoot).toBeTruthy()
  })

  test('reports errors thrown from syncFile via the error event', async () => {
    const { claudeRoot } = makeTempRoots()
    const { syncer } = makeStubSyncer({ throws: new Error('parse bomb') })
    const errors: Error[] = []
    const w = await startWatcher(syncer)
    w.on('error', (_event, data) => { errors.push((data as { error: Error }).error) })

    writeFileSync(join(claudeRoot, 'project-a', 'bad.jsonl'), '{}\n')

    await waitFor(() => errors.length > 0, 3000)
    expect(errors[0]?.message).toBe('parse bomb')
  })
})
