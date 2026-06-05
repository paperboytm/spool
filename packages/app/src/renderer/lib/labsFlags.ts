// Tri-state storage at `spool.labs.<flag>`:
//   "1"      → user explicitly enabled
//   "0"      → user explicitly disabled (overrides DEV / env upstream)
//   missing  → no opinion; resolver falls back to DEV / env
// The explicit "0" is the reason this isn't just a boolean pref —
// without it, a user couldn't turn off a feature that DEV or env pins on.

export type LabsFlag = 'share'

const PREFIX = 'spool.labs.'

type Listener = () => void

let store: Storage | null = resolveDefaultStorage()
const listeners = new Map<string, Set<Listener>>()

function resolveDefaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function keyFor(flag: LabsFlag): string {
  return PREFIX + flag
}

export function getLabsFlag(flag: LabsFlag): boolean | null {
  const raw = store?.getItem(keyFor(flag))
  if (raw === '1') return true
  if (raw === '0') return false
  return null
}

export function setLabsFlag(flag: LabsFlag, enabled: boolean): void {
  if (getLabsFlag(flag) === enabled) return
  store?.setItem(keyFor(flag), enabled ? '1' : '0')
  const set = listeners.get(flag)
  if (set) for (const fn of set) fn()
}

export function subscribeLabsFlag(flag: LabsFlag, listener: Listener): () => void {
  let set = listeners.get(flag)
  if (!set) {
    set = new Set()
    listeners.set(flag, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(flag)
  }
}

export function __resetLabsFlagsForTest(nextStore: Storage | null): void {
  store = nextStore
  listeners.clear()
}
