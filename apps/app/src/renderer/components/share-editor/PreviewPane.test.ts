import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  nextProgressiveCount,
  PREVIEW_INITIAL_TURNS,
  PREVIEW_TURNS_PER_FRAME,
} from './preview-progressive.js'

describe('nextProgressiveCount', () => {
  it('advances by one chunk per step and clamps at total', () => {
    expect(nextProgressiveCount(PREVIEW_INITIAL_TURNS, 10_000)).toBe(
      PREVIEW_INITIAL_TURNS + PREVIEW_TURNS_PER_FRAME,
    )
    expect(nextProgressiveCount(9_900, 10_000)).toBe(10_000)
    expect(nextProgressiveCount(10_000, 10_000)).toBe(10_000)
  })

  it('reaches every total in finitely many steps', () => {
    for (const total of [0, 1, PREVIEW_INITIAL_TURNS, 7126, 20_000]) {
      let c = Math.min(PREVIEW_INITIAL_TURNS, total)
      let steps = 0
      while (c < total) {
        c = nextProgressiveCount(c, total)
        steps++
        expect(steps).toBeLessThan(1_000)
      }
      expect(c).toBe(total)
    }
  })
})

describe('PREVIEW_INITIAL_TURNS covers every e2e fixture', () => {
  // The whole regression story for the share e2e suites rests on small
  // documents rendering WHOLE on the first commit — progressive
  // mounting must be invisible to them. JSONL line counts upper-bound
  // the turn count (meta/sidechain lines get filtered out), so this
  // guard trips before a grown fixture can silently put the e2e suite
  // into mid-fill territory.
  // Fixtures that intentionally exceed the first chunk. Specs that
  // open one of these in the share editor MUST wait for the
  // `[data-render-complete]` marker on share-preview-render before
  // asserting on preview DOM (see share-turn-selector.spec.ts) — the
  // document mounts progressively and mid-fill counts race.
  const EXEMPT = new Set([
    // session-detail.spec.ts (virtuoso) + share-turn-selector.spec.ts
    // (fill-aware via data-render-complete).
    'test-session-large.jsonl',
  ])

  it('every claude-projects fixture fits in the first chunk', () => {
    const root = join(__dirname, '..', '..', '..', '..', 'e2e', 'fixtures', 'claude-projects')
    const jsonls: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (name.endsWith('.jsonl') && !EXEMPT.has(name)) jsonls.push(p)
      }
    }
    walk(root)
    expect(jsonls.length).toBeGreaterThan(0)
    for (const p of jsonls) {
      const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean).length
      expect(lines, p).toBeLessThanOrEqual(PREVIEW_INITIAL_TURNS)
    }
  })
})
