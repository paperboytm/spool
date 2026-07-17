import { describe, it, expect } from 'vitest'
import {
  applySet,
  applyUndo,
  applyRedo,
  type UndoSnapshot,
} from './useUndoableState.js'

const opts = { coalesceMs: 500, maxHistory: 5 }

function snap<T>(present: T, past: T[] = [], future: T[] = []): UndoSnapshot<T> {
  return { past, present, future }
}

describe('applySet', () => {
  it('pushes the previous present onto past on the first set', () => {
    const initial = snap('a')
    const result = applySet(initial, 'b', 0, 1_000, opts)
    expect(result.snap.past).toEqual(['a'])
    expect(result.snap.present).toBe('b')
    expect(result.snap.future).toEqual([])
    expect(result.lastSetAt).toBe(1_000)
  })

  it('coalesces consecutive sets within the time window', () => {
    const initial = snap('a')
    const first = applySet(initial, 'b', 0, 1_000, opts)
    const second = applySet(first.snap, 'c', first.lastSetAt, 1_200, opts)
    // past should still be just ['a'] — the rapid 'b' → 'c' edit is one
    // undo step that brings the user back to 'a'.
    expect(second.snap.past).toEqual(['a'])
    expect(second.snap.present).toBe('c')
  })

  it('starts a new entry once outside the coalesce window', () => {
    const initial = snap('a')
    const first = applySet(initial, 'b', 0, 1_000, opts)
    const second = applySet(first.snap, 'c', first.lastSetAt, 2_000, opts)
    expect(second.snap.past).toEqual(['a', 'b'])
    expect(second.snap.present).toBe('c')
  })

  it('clears the future on a non-coalesced set', () => {
    const initial: UndoSnapshot<string> = snap('b', ['a'], ['c'])
    const result = applySet(initial, 'd', 0, 1_000, opts)
    expect(result.snap.future).toEqual([])
  })

  it('preserves the future during coalescing (mid-edit chain)', () => {
    const initial: UndoSnapshot<string> = snap('b', ['a'], ['c'])
    const result = applySet(initial, 'b2', 800, 1_000, opts)
    expect(result.snap.future).toEqual(['c'])
  })

  it('returns the same snapshot identity when set value matches present', () => {
    const initial = snap('a')
    const result = applySet(initial, 'a', 0, 1_000, opts)
    expect(result.snap).toBe(initial)
    expect(result.lastSetAt).toBe(0)
  })

  it('caps past at maxHistory by dropping the oldest entry', () => {
    let s = snap('p0')
    let last = 0
    // 6 non-coalesced sets, so past would naturally grow to 6
    for (let i = 0; i < 6; i++) {
      const t = (i + 1) * 1_000
      const result = applySet(s, `p${i + 1}`, last, t, opts)
      s = result.snap
      last = result.lastSetAt
    }
    expect(s.past).toHaveLength(5)
    // Oldest entry 'p0' is gone; past now starts at 'p1'.
    expect(s.past[0]).toBe('p1')
    expect(s.present).toBe('p6')
  })
})

describe('applyUndo', () => {
  it('moves the latest past entry into present and stashes prior present in future', () => {
    const s = snap('c', ['a', 'b'], [])
    const result = applyUndo(s)
    expect(result.past).toEqual(['a'])
    expect(result.present).toBe('b')
    expect(result.future).toEqual(['c'])
  })

  it('is a no-op when past is empty', () => {
    const s = snap('a', [], ['b'])
    expect(applyUndo(s)).toBe(s)
  })
})

describe('applyRedo', () => {
  it('moves the latest future entry into present and stashes prior present in past', () => {
    const s = snap('a', [], ['c', 'b'])
    const result = applyRedo(s)
    expect(result.past).toEqual(['a'])
    expect(result.present).toBe('b')
    expect(result.future).toEqual(['c'])
  })

  it('is a no-op when future is empty', () => {
    const s = snap('a', ['z'], [])
    expect(applyRedo(s)).toBe(s)
  })
})

describe('integration: edit -> undo -> redo -> edit clears redo', () => {
  it('clears the redo stack when the user starts a fresh edit after undoing', () => {
    let s = snap('initial')
    let last = 0
    let result = applySet(s, 'a', last, 1_000, opts)
    s = result.snap; last = result.lastSetAt
    result = applySet(s, 'b', last, 2_000, opts)
    s = result.snap; last = result.lastSetAt
    // Two undos take us back past 'a' to 'initial'.
    s = applyUndo(s)            // present 'a', future ['b']
    s = applyUndo(s)            // present 'initial', future ['b', 'a']
    expect(s.present).toBe('initial')
    expect(s.future).toEqual(['b', 'a'])
    // A new edit clears the redo branch (lastSetAt reset to 0 means no
    // coalescing, so this is a non-coalesced set).
    result = applySet(s, 'c', 0, 5_000, opts)
    s = result.snap
    expect(s.present).toBe('c')
    expect(s.future).toEqual([])
    expect(s.past).toEqual(['initial'])
  })
})
