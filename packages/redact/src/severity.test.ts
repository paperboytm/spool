import { describe, it, expect } from 'vitest'
import { severityOf, HIGH_SEVERITY_KINDS, INFO_SEVERITY_KINDS } from './severity.js'

describe('severity', () => {
  it('credential kinds are high', () => {
    expect(severityOf('api-key')).toBe('high')
    expect(severityOf('private-key')).toBe('high')
    expect(severityOf('cloud-cred-ini')).toBe('high')
    expect(severityOf('connection-string')).toBe('high')
    expect(severityOf('jwt')).toBe('high')
  })

  it('identity kinds are low', () => {
    expect(severityOf('email')).toBe('low')
    expect(severityOf('phone')).toBe('low')
    expect(severityOf('person-name')).toBe('low')
    expect(severityOf('street-address')).toBe('low')
    expect(severityOf('date-of-birth')).toBe('low')
    expect(severityOf('credit-card')).toBe('low')
    expect(severityOf('ssn')).toBe('low')
  })

  it('infra signals are info — hidden by default to avoid drowning real findings', () => {
    expect(severityOf('absolute-path')).toBe('info')
    expect(severityOf('ip')).toBe('info')
    expect(severityOf('internal-host')).toBe('info')
  })

  it('HIGH_SEVERITY_KINDS has 13 entries (credentials tier)', () => {
    expect(HIGH_SEVERITY_KINDS.size).toBe(13)
  })

  it('INFO_SEVERITY_KINDS contains the three noisy infra kinds', () => {
    expect(INFO_SEVERITY_KINDS.size).toBe(3)
    expect(INFO_SEVERITY_KINDS.has('absolute-path')).toBe(true)
    expect(INFO_SEVERITY_KINDS.has('ip')).toBe(true)
    expect(INFO_SEVERITY_KINDS.has('internal-host')).toBe(true)
  })
})
