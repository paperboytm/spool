import { describe, it, expect } from 'vitest'
import { shouldAutoActivatePf } from './pf-activation.js'

const base = {
  phase: 'installed',
  securityBooted: true,
  pfActivationPending: true,
  pfEnabled: false,
}

describe('shouldAutoActivatePf', () => {
  it('activates when a model installs while the feature is on and activation is pending', () => {
    expect(shouldAutoActivatePf(base)).toBe(true)
  })

  it('does NOT activate when Security was torn down mid-download (the transient guard)', () => {
    // User disabled Security while the 945MB model was still downloading;
    // the coordinator singleton finished the download, but we must not
    // spawn a hidden inference window behind an OFF toggle.
    expect(shouldAutoActivatePf({ ...base, securityBooted: false })).toBe(false)
  })

  it('does NOT activate on non-install phases (download progress events)', () => {
    expect(shouldAutoActivatePf({ ...base, phase: 'downloading' })).toBe(false)
    expect(shouldAutoActivatePf({ ...base, phase: 'not-installed' })).toBe(false)
  })

  it('does NOT activate when the user never requested it (no pending flag)', () => {
    // e.g. the model was already present from a prior session; arriving at
    // 'installed' on boot must not silently turn PF on.
    expect(shouldAutoActivatePf({ ...base, pfActivationPending: false })).toBe(false)
  })

  it('does NOT re-activate when PF is already enabled', () => {
    expect(shouldAutoActivatePf({ ...base, pfEnabled: true })).toBe(false)
  })
})
