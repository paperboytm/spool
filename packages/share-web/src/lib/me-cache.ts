// Stale-while-revalidate localStorage cache for the signed-in user's
// public identity (name + avatar URL). Read at Header mount so the
// first paint shows a real avatar instead of a 100ms blank-spot while
// /api/me round-trips. The fresh fetch then revalidates and writes
// back. True auth is always backend-validated — this only affects the
// chrome glyph during the boot window.
//
// Schema is versioned; bumping `v` invalidates every reader without
// needing a separate migration step.

const KEY = 'spool.share-web.me'
const VERSION = 1

export interface CachedMe {
  name: string | null
  avatar_url: string | null
}

interface StoredShape {
  v: number
  name: string | null
  avatar_url: string | null
}

export function readCachedMe(): CachedMe | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredShape
    if (parsed.v !== VERSION) return null
    return { name: parsed.name ?? null, avatar_url: parsed.avatar_url ?? null }
  } catch {
    // localStorage unavailable (private mode, disabled) or JSON corrupt.
    // Treat as cache miss — no thrown error reaches the renderer.
    return null
  }
}

export function writeCachedMe(me: CachedMe): void {
  try {
    const payload: StoredShape = {
      v: VERSION,
      name: me.name,
      avatar_url: me.avatar_url,
    }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCachedMe(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
