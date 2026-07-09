import { describe, it, expect } from 'vitest'
import {
  READER_INITIAL_TURNS,
  READER_TURNS_PER_FRAME,
  nextReaderCount,
} from './use-progressive-turns'

describe('nextReaderCount', () => {
  it('grows by one frame step', () => {
    expect(nextReaderCount(READER_INITIAL_TURNS, 10_000)).toBe(
      READER_INITIAL_TURNS + READER_TURNS_PER_FRAME,
    )
  })

  it('never overshoots the total', () => {
    for (const total of [0, 1, READER_INITIAL_TURNS, 517, 10_000]) {
      let c = Math.min(READER_INITIAL_TURNS, total)
      // Drive the fill loop to completion and assert it lands exactly on
      // total and never exceeds it.
      for (let i = 0; i < 1000 && c < total; i++) {
        const next = nextReaderCount(c, total)
        expect(next).toBeGreaterThan(c)
        expect(next).toBeLessThanOrEqual(total)
        c = next
      }
      expect(c).toBe(total)
    }
  })

  it('respects a custom step', () => {
    expect(nextReaderCount(0, 100, 25)).toBe(25)
    expect(nextReaderCount(90, 100, 25)).toBe(100)
  })
})
