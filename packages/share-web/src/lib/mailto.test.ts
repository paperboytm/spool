import { describe, expect, it } from 'vitest'

import { reportMailto } from './mailto'

describe('reportMailto', () => {
  it('targets abuse@spool.pro', () => {
    const href = reportMailto('K7s4F3pQz1mB9XnLrV8aE')
    expect(href.startsWith('mailto:abuse@spool.pro?')).toBe(true)
  })

  it('encodes the share id into both subject and body', () => {
    const id = 'K7s4F3pQz1mB9XnLrV8aE'
    const href = reportMailto(id)
    const url = new URL(href)
    expect(url.searchParams.get('subject')).toBe(`Report spool.pro/s/${id}`)
    const body = url.searchParams.get('body') ?? ''
    expect(body).toContain(`Share URL: https://spool.pro/s/${id}`)
    expect(body).toContain('Reason (please pick one): copyright | privacy | harassment | illegal | spam | other')
    expect(body).toContain('Details:')
  })

  it('percent-encodes spaces in the query string (not "+")', () => {
    // Some mail clients don't decode "+" as space in mailto bodies; %20 is safer.
    const href = reportMailto('x'.repeat(21))
    expect(href).not.toContain('?subject=Report+')
    expect(href).toContain('?subject=Report%20')
  })
})
