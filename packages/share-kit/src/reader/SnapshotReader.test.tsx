import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SnapshotReader } from './SnapshotReader'
import { READER_INITIAL_TURNS } from './use-progressive-turns'
import type { Snapshot } from '../lib/types'

// Each turn body carries a unique marker so we can assert exactly which
// turns made it into the first paint.
function marker(i: number): string {
  return `TURNMARKER_${i}_END`
}

function makeSnapshot(turnCount: number): Snapshot {
  const turns = Array.from({ length: turnCount }, (_, i) => ({
    id: `t${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${marker(i)}`,
  }))
  return {
    schema_version: 1,
    source: { kind: 'spool-session', captured_at: '2026-07-01T00:00:00.000Z' },
    conversation: {
      title: 'Big conversation',
      turns,
      turn_order: turns.map((t) => t.id),
      hidden_turns: [],
    },
    editor_opts: {
      template: 'chat',
      paper: 'ivory',
      typeface: 'sans',
      colorway: 'amber',
      density: 'compact',
      masthead: false,
      colophon: false,
      avatars: true,
      show_byline: false,
    },
  }
}

// The initial-slice branch only engages when requestAnimationFrame
// exists (a browser). This vitest env is node, so simulate the browser
// by installing a no-op rAF around the client-behavior tests; without
// it the hook initializes to the COMPLETE document (the SSR guarantee).
function withFakeRaf<T>(fn: () => T): T {
  const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown }
  g.requestAnimationFrame = () => 0
  g.cancelAnimationFrame = () => {}
  try {
    return fn()
  } finally {
    delete g.requestAnimationFrame
    delete g.cancelAnimationFrame
  }
}

describe('SnapshotReader progressive mount', () => {
  it('renders every turn for a small snapshot on first paint', () => {
    const html = withFakeRaf(() =>
      renderToStaticMarkup(<SnapshotReader snapshot={makeSnapshot(5)} />),
    )
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(marker(i))
    }
  })

  it('renders only the initial slice for a large snapshot in a browser, deferring the tail', () => {
    const total = READER_INITIAL_TURNS + 50
    const html = withFakeRaf(() =>
      renderToStaticMarkup(<SnapshotReader snapshot={makeSnapshot(total)} />),
    )
    // First slice is present…
    expect(html).toContain(marker(0))
    expect(html).toContain(marker(READER_INITIAL_TURNS - 1))
    // …the tail is deferred to later animation frames, so it is NOT in
    // the first commit that gates first paint.
    expect(html).not.toContain(marker(READER_INITIAL_TURNS))
    expect(html).not.toContain(marker(total - 1))
  })

  it('renders the COMPLETE document under SSR (no requestAnimationFrame)', () => {
    // Effects never run during server/static rendering, so completeness
    // must come from state initialization — a prerender or static export
    // of a large share must never ship a silently truncated conversation.
    const total = READER_INITIAL_TURNS + 50
    const html = renderToStaticMarkup(<SnapshotReader snapshot={makeSnapshot(total)} />)
    expect(html).toContain(marker(0))
    expect(html).toContain(marker(READER_INITIAL_TURNS))
    expect(html).toContain(marker(total - 1))
  })
})
