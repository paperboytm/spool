import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SPOOL_DIR,
  cachedResolveAsync,
  clearResolveCache,
  getResolveCacheSnapshot,
  hydrateResolveCache,
} from '@spool-lab/core'

/**
 * Persistent companion to core's in-memory `cachedResolveAsync`. Without
 * this, every cold launch re-runs an interactive login shell per agent —
 * which on a machine with a slow .zshrc stalls the main-process event loop
 * for several seconds and produces a launch beachball.
 *
 * Stored as a flat `{ [bin]: path | null }` JSON next to `ui.json` under
 * `~/.spool/`. Reads on hydrate are best-effort: a missing or malformed
 * file just yields an empty cache and the next resolve falls through to
 * the live lookup. Writes happen after every successful resolve, so the
 * very next launch is fast.
 */

const CACHE_PATH = join(SPOOL_DIR, 'resolved-bins.json')

let dirty = false

function readDisk(): Record<string, string | null> {
  try {
    if (!existsSync(CACHE_PATH)) return {}
    const raw = readFileSync(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' || v === null) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeDisk(snapshot: Record<string, string | null>): void {
  try {
    mkdirSync(SPOOL_DIR, { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(snapshot, null, 2), 'utf8')
  } catch (err) {
    console.error('[binary-cache] persist failed:', err)
  }
}

/** Load the on-disk cache into core's in-memory store. Call once during
 *  `app.whenReady`, before any code path that might hit `cachedResolveAsync`. */
export function hydrateBinaryCache(): void {
  hydrateResolveCache(readDisk())
}

/** Resolve a binary, persisting the result to disk after a successful
 *  miss-then-resolve so the next process start can read it back. */
export async function cachedResolveAsyncPersistent(name: string, extras: string[] = []): Promise<string | null> {
  const before = getResolveCacheSnapshot()
  const p = await cachedResolveAsync(name, extras)
  const after = getResolveCacheSnapshot()
  if (before[name] !== after[name]) {
    dirty = true
    queueMicrotask(flush)
  }
  return p
}

function flush(): void {
  if (!dirty) return
  dirty = false
  writeDisk(getResolveCacheSnapshot())
}

/** Forget a cached entry both in memory and on disk. Call this after the
 *  user installs or removes an agent so the next lookup re-probes. */
export function clearBinaryCacheEntry(name: string): void {
  clearResolveCache(name)
  writeDisk(getResolveCacheSnapshot())
}
