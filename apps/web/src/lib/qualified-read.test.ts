import { describe, expect, it } from 'vite-plus/test'

import { QUALIFIED_READ_ACTIVE_MS, QualifiedReadGate } from './qualified-read'

describe('QualifiedReadGate', () => {
  it('requires both 30 seconds of active time and meaningful depth', () => {
    const gate = new QualifiedReadGate(0, true)
    gate.markMeaningfulDepth()
    gate.advance(QUALIFIED_READ_ACTIVE_MS - 1, true)
    expect(gate.takeQualifiedRead()).toBe(false)

    gate.advance(QUALIFIED_READ_ACTIVE_MS, true)
    expect(gate.takeQualifiedRead()).toBe(true)
    expect(gate.takeQualifiedRead()).toBe(false)
  })

  it('does not count time while the page is inactive', () => {
    const gate = new QualifiedReadGate(0, true)
    gate.markEvidenceInteraction()
    gate.advance(10_000, false)
    gate.advance(50_000, true)
    gate.advance(69_999, true)

    expect(gate.accumulatedActiveMs).toBe(29_999)
    expect(gate.takeQualifiedRead()).toBe(false)
    gate.advance(70_000, true)
    expect(gate.takeQualifiedRead()).toBe(true)
  })

  it('accepts an evidence interaction instead of scroll depth', () => {
    const gate = new QualifiedReadGate(0, true)
    gate.advance(QUALIFIED_READ_ACTIVE_MS, true)
    expect(gate.takeQualifiedRead()).toBe(false)

    gate.markEvidenceInteraction()
    expect(gate.takeQualifiedRead()).toBe(true)
  })
})
