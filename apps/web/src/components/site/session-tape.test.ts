import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import {
  getSessionTapeMotionPolicy,
  getSessionTapeRenderPolicy,
  getSessionTapeMotionTarget,
  getTapeContactPhases,
  getTapeCurlSample,
  getTapeGeometryPolicy,
  SESSION_TAPE_RECORD,
  SESSION_TUI_LINES,
  SessionTape,
} from './session-tape'

describe('SessionTape', () => {
  it('stops on a complete frame when reduced motion is requested', () => {
    expect(getSessionTapeRenderPolicy(true)).toEqual({
      animate: false,
      renderOnce: true,
      transparentCanvas: true,
    })
  })

  it('animates on a transparent canvas in the default motion mode', () => {
    expect(getSessionTapeRenderPolicy(false)).toEqual({
      animate: true,
      renderOnce: false,
      transparentCanvas: true,
    })
  })

  it('uses most of the available responsive arena before turning', () => {
    for (const [width, height, minimumHorizontalRadius] of [
      [1440, 760, 5],
      [768, 1024, 2.2],
      [375, 720, 1],
    ] as const) {
      const policy = getSessionTapeMotionPolicy(width, height)
      expect(policy.horizontalRadius).toBeGreaterThan(minimumHorizontalRadius)
      expect(policy.depthRadius).toBeGreaterThan(1.7)
      const samples = Array.from({ length: 241 }, (_, index) =>
        getSessionTapeMotionTarget((index / 240) * policy.cycleSeconds, policy),
      )
      expect(samples.every(({ x }) => Math.abs(x) <= policy.horizontalRadius)).toBe(true)
      expect(samples.every(({ z }) => Math.abs(z) <= policy.depthRadius)).toBe(true)
      const xValues = samples.map(({ x }) => x)
      expect(Math.max(...xValues) - Math.min(...xValues)).toBeGreaterThan(
        policy.horizontalRadius * 1.98,
      )

      const approach = Array.from({ length: 9 }, (_, index) =>
        getSessionTapeMotionTarget(index, policy),
      )
      expect(approach.every(({ x }, index) => index === 0 || x > approach[index - 1]!.x)).toBe(true)
    }
  })

  it('keeps publication, evidence, and continuation trust signals explicit', () => {
    expect(SESSION_TAPE_RECORD.author).toMatch(/^@/)
    expect(SESSION_TAPE_RECORD.published).toMatch(/^published /)
    expect(SESSION_TAPE_RECORD.visibility).toBe('Public')
    expect(SESSION_TAPE_RECORD.evidence).toContain('5/5 passed')
    expect(SESSION_TAPE_RECORD.lineage).toContain('@arjun')
  })

  it('prints fixed-width TUI rows across the paper instead of card panels', () => {
    expect(SESSION_TUI_LINES).toHaveLength(40)
    expect(SESSION_TUI_LINES.every((line) => Array.from(line.text).length === 20)).toBe(true)
    expect(SESSION_TUI_LINES.some((line) => line.text.includes('TOOL · VERIFY'))).toBe(true)
    expect(SESSION_TUI_LINES.some((line) => line.text.includes('LINEAGE'))).toBe(true)
  })

  it('locks one atlas cycle to one barrel revolution with matching contact phases', () => {
    const geometry = getTapeGeometryPolicy()
    expect(geometry.rollRadius * Math.PI * 2).toBeCloseTo(geometry.atlasSpan, 10)
    expect(geometry.paperWidth / geometry.rollRadius).toBeCloseTo(0.86, 2)
    for (const distance of [0, 1.25, geometry.atlasSpan * 3.7]) {
      const phases = getTapeContactPhases(distance, geometry.atlasSpan)
      expect(phases.barrelBottom).toBeCloseTo(phases.ribbon, 10)
    }
  })

  it('starts the peel exactly tangent to the flat paper', () => {
    const { rollRadius } = getTapeGeometryPolicy()
    const contact = getTapeCurlSample(0, rollRadius)
    expect(contact).toEqual({
      forward: 0,
      height: 0,
      normalForward: -0,
      normalUp: 1,
      surfaceDistance: 0,
    })
  })

  it('server-renders a decorative TUI fallback without the removed stage label', () => {
    const markup = renderToStaticMarkup(createElement(SessionTape))
    expect(markup).toContain('session-tape__fallback')
    expect(markup).toContain('SESSION · PUBLIC')
    expect(markup).not.toContain('live Session record')
    expect(markup).toContain('aria-hidden="true"')
  })
})
