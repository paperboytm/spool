import { useEffect } from 'react'

import { postQualifiedRead } from './discovery'

export const QUALIFIED_READ_ACTIVE_MS = 30_000

/**
 * Accumulates only foreground/focused time and opens the engagement gate
 * after either meaningful reading depth or an evidence interaction.
 */
export class QualifiedReadGate {
  private activeMs = 0
  private lastNow: number
  private wasActive: boolean
  private depthReached = false
  private evidenceInteracted = false
  private consumed = false

  constructor(now: number, active: boolean) {
    this.lastNow = now
    this.wasActive = active
  }

  advance(now: number, active: boolean): void {
    if (this.wasActive && Number.isFinite(now) && now >= this.lastNow) {
      this.activeMs += now - this.lastNow
    }
    this.lastNow = now
    this.wasActive = active
  }

  markMeaningfulDepth(): void {
    this.depthReached = true
  }

  markEvidenceInteraction(): void {
    this.evidenceInteracted = true
  }

  takeQualifiedRead(): boolean {
    if (
      this.consumed ||
      this.activeMs < QUALIFIED_READ_ACTIVE_MS ||
      (!this.depthReached && !this.evidenceInteracted)
    ) {
      return false
    }
    this.consumed = true
    return true
  }

  get accumulatedActiveMs(): number {
    return this.activeMs
  }
}

function pageIsActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function meaningfulDepthReached(): boolean {
  const documentHeight = document.documentElement.scrollHeight
  if (documentHeight <= 0) return false
  return (window.scrollY + window.innerHeight) / documentHeight >= 0.5
}

/** Attach the qualified-read signal to a ready Hub Session reader. */
export function useQualifiedRead(sid: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const gate = new QualifiedReadGate(performance.now(), pageIsActive())
    let attempted = false

    const trySend = () => {
      if (attempted || !gate.takeQualifiedRead()) return
      // One attempt per reader mount. The API deduplicates the same
      // reader/session again for the rest of the UTC day.
      attempted = true
      void postQualifiedRead(sid)
    }

    const tick = () => {
      gate.advance(performance.now(), pageIsActive())
      trySend()
    }

    const checkDepth = () => {
      gate.advance(performance.now(), pageIsActive())
      if (meaningfulDepthReached()) gate.markMeaningfulDepth()
      trySend()
    }

    const evidenceInteraction = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-qualified-read-evidence]') !== null
      ) {
        gate.advance(performance.now(), pageIsActive())
        gate.markEvidenceInteraction()
        trySend()
      }
    }

    const interval = window.setInterval(tick, 1_000)
    window.addEventListener('scroll', checkDepth, { passive: true })
    window.addEventListener('focus', tick)
    window.addEventListener('blur', tick)
    document.addEventListener('visibilitychange', tick)
    document.addEventListener('pointerdown', evidenceInteraction)
    checkDepth()

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('scroll', checkDepth)
      window.removeEventListener('focus', tick)
      window.removeEventListener('blur', tick)
      document.removeEventListener('visibilitychange', tick)
      document.removeEventListener('pointerdown', evidenceInteraction)
    }
  }, [enabled, sid])
}
