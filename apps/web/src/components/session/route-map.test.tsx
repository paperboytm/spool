import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import type { SessionRoute } from '../../lib/session-route'
import { SessionRouteMap } from './route-map'

const route: SessionRoute = {
  goal: 'Make the public Session route understandable on every device',
  phases: [
    {
      recordIndex: 12,
      timestamp: '2026-07-22T07:00:00.000Z',
      isPrompt: true,
      label: 'Inspect the existing reader',
      tools: 3,
      edits: 0,
      commands: 1,
      agents: 0,
      errors: 0,
      checkRuns: 0,
      checkFails: 0,
    },
    {
      recordIndex: 28,
      timestamp: '2026-07-22T07:15:00.000Z',
      isPrompt: true,
      label: 'Adapt the map for touch and keyboard input',
      tools: 5,
      edits: 2,
      commands: 1,
      agents: 1,
      errors: 1,
      checkRuns: 1,
      checkFails: 1,
    },
  ],
  totalErrors: 2,
  prUrl: 'https://github.com/paperboytm/spool/pull/99',
  prLabel: 'PR #99 · paperboytm/spool',
}

function render(): string {
  return renderToStaticMarkup(<SessionRouteMap route={route} onJump={vi.fn()} />)
}

describe('SessionRouteMap', () => {
  it('labels the route and preserves its full goal on narrow layouts', () => {
    const html = render()

    expect(html).toContain('aria-labelledby="session-route-title"')
    expect(html).toContain('id="session-route-title"')
    expect(html).toContain(route.goal)
    expect(html).toContain('break-words')
    expect(html).toContain('lg:hidden')
    expect(html).toContain('hidden overflow-x-auto')
  })

  it('uses native buttons with on-scale 48px touch targets for every phase', () => {
    const html = render()
    const buttons = html.match(/<button\b[^>]*>/g) ?? []

    // Each responsive presentation has one control per phase; CSS exposes only
    // the presentation matching the active breakpoint.
    expect(buttons).toHaveLength(route.phases.length * 2)
    expect(buttons.every((button) => button.includes('type="button"'))).toBe(true)
    expect(buttons.every((button) => /(?:min-h-12|size-12)/.test(button))).toBe(true)
    expect(html).toContain('aria-label="Phase 2 of 2: Adapt the map for touch and keyboard input')
    expect(html).toContain('focus-visible:outline-[var(--accent)]')
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('tabindex="0"')
  })

  it('keeps route metadata at the design-system type floor', () => {
    const html = render()

    expect(html).toContain('text-xs')
    expect(html).toContain('text-[11px]')
    expect(html).not.toContain('text-[9px]')
    expect(html).not.toContain('py-2.5')
    expect(html).toContain('2 dead ends')
    expect(html).not.toContain('3 dead ends')
    expect(html).not.toContain('var(--faint)')
    expect(html).toContain('Outcome: PR #99 · paperboytm/spool')
  })

  it('renders the pull request as an explicit, safe external link', () => {
    const html = render()
    const anchor = html.match(/<a\b[^>]*>/)?.[0]

    expect(anchor).toContain(`href="${route.prUrl}"`)
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toMatch(/\brel="[^"]*\bnoopener\b[^"]*"/)
    expect(anchor).toMatch(/\brel="[^"]*\bnoreferrer\b[^"]*"/)
    expect(anchor).toContain('min-h-12')
    expect(html).toContain('(opens in a new tab)')
  })

  it('does not render an untrusted outcome URL', () => {
    const html = renderToStaticMarkup(
      <SessionRouteMap route={{ ...route, prUrl: 'javascript:alert(1)' }} onJump={vi.fn()} />,
    )

    expect(html).not.toContain('<a')
    expect(html).not.toContain('javascript:')
  })
})
