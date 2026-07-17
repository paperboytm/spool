import { describe, expect, it } from 'vitest'
import type { CheckResult } from '@spool-lab/core'
import { compareSemver, refineForAppVersion } from './doctor.js'

describe('compareSemver', () => {
  it('handles equal versions', () => {
    expect(compareSemver('0.4.11', '0.4.11')).toBe(0)
  })

  it('orders by numeric segments, not lexicographic', () => {
    // 0.4.2 vs 0.4.11 — the bug a naive string compare would have.
    expect(compareSemver('0.4.2', '0.4.11')).toBeLessThan(0)
    expect(compareSemver('0.4.11', '0.4.2')).toBeGreaterThan(0)
  })

  it('orders across major and minor', () => {
    expect(compareSemver('0.5.0', '0.4.99')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })

  it('strips pre-release suffix when comparing major.minor.patch', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(0)
    expect(compareSemver('0.5.0-beta.1', '0.4.11')).toBeGreaterThan(0)
  })

  it('treats missing segments as 0', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0)
    expect(compareSemver('1.2', '1.2.0')).toBe(0)
  })
})

describe('refineForAppVersion', () => {
  const schemaCompatErr = (): CheckResult => ({
    id: 'versions.schema-compat',
    category: 'versions',
    title: 'Database schema compatibility',
    severity: 'error',
    message: 'DB is at v10, CLI expects v11',
    fix: {
      description: 'Migrate database from v10 to v11',
      destructive: false,
      apply: async () => ({ ok: true, message: 'migrated' }),
    },
  })

  it('returns results unchanged when no app version is detected', () => {
    const input = [schemaCompatErr()]
    expect(refineForAppVersion(input, '0.5.0', null)).toEqual(input)
  })

  it('returns results unchanged when CLI version is unknown', () => {
    const input = [schemaCompatErr()]
    expect(
      refineForAppVersion(input, 'unknown', { version: '0.4.11', path: '/Applications/Spool.app' }),
    ).toEqual(input)
  })

  it('returns results unchanged when app is at or ahead of CLI', () => {
    const input = [schemaCompatErr()]
    const out = refineForAppVersion(input, '0.4.11', { version: '0.4.11', path: '/x' })
    expect(out[0]?.message).toBe('DB is at v10, CLI expects v11')
    expect(out[0]?.fix?.destructive).toBe(false)
  })

  it('reframes the message and marks fix destructive when CLI is ahead of app', () => {
    const out = refineForAppVersion(
      [schemaCompatErr()],
      '0.5.0',
      { version: '0.4.11', path: '/Applications/Spool.app' },
    )
    const refined = out[0]
    expect(refined?.message).toContain('Spool.app is 0.4.11')
    expect(refined?.message).toContain('older than this CLI 0.5.0')
    expect(refined?.fix?.destructive).toBe(true)
    expect(refined?.fix?.description).toContain('Upgrade Spool.app to 0.5.0 first')
    expect(refined?.fix?.description).toContain('--fix --force overrides')
  })

  it('preserves the original apply function so --fix --force still works', async () => {
    const out = refineForAppVersion(
      [schemaCompatErr()],
      '0.5.0',
      { version: '0.4.11', path: '/x' },
    )
    const result = await out[0]?.fix?.apply()
    expect(result).toEqual({ ok: true, message: 'migrated' })
  })

  it('leaves unrelated checks untouched', () => {
    const unrelated: CheckResult = {
      id: 'db.integrity',
      category: 'db',
      title: 'Database integrity',
      severity: 'error',
      message: 'broken',
    }
    const out = refineForAppVersion(
      [unrelated, schemaCompatErr()],
      '0.5.0',
      { version: '0.4.11', path: '/x' },
    )
    expect(out[0]).toEqual(unrelated)
    expect(out[1]?.fix?.destructive).toBe(true)
  })
})
