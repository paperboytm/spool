import { describe, expect, it } from 'vitest'

import { reportMailto } from './mailto'

const ID = 'K7s4F3pQz1mB9XnLrV8aE'

describe('reportMailto', () => {
  it('targets abuse@spool.pro', () => {
    expect(reportMailto(ID, 'https://spool.pro').startsWith('mailto:abuse@spool.pro?')).toBe(true)
  })

  it('encodes the share id into both subject and body using the given origin', () => {
    const href = reportMailto(ID, 'https://spool.pro')
    const url = new URL(href)
    expect(url.searchParams.get('subject')).toBe(`Report spool.pro/s/${ID}`)
    const body = url.searchParams.get('body') ?? ''
    expect(body).toContain(`Share URL: https://spool.pro/s/${ID}`)
    expect(body).toContain('Reason (please pick one): copyright | privacy | harassment | illegal | spam | other')
    expect(body).toContain('Details:')
  })

  it('respects an explicit origin (dev/staging reader URL matches the reported share URL)', () => {
    const href = reportMailto(ID, 'http://localhost:3002')
    const url = new URL(href)
    expect(url.searchParams.get('subject')).toBe(`Report localhost:3002/s/${ID}`)
    expect(url.searchParams.get('body') ?? '').toContain(
      `Share URL: http://localhost:3002/s/${ID}`,
    )
  })

  it('percent-encodes spaces in the query string (not "+")', () => {
    // Some mail clients don't decode "+" as space in mailto bodies; %20 is safer.
    const href = reportMailto('x'.repeat(21), 'https://spool.pro')
    expect(href).not.toContain('?subject=Report+')
    expect(href).toContain('?subject=Report%20')
  })

  it('falls back to spool.pro when no window and no origin override', () => {
    // node test environment — `window` is undefined; the helper should
    // pick the prod default rather than emit an empty origin string.
    const url = new URL(reportMailto(ID))
    expect(url.searchParams.get('subject')).toBe(`Report spool.pro/s/${ID}`)
  })
})
