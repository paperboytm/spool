import { describe, expect, it } from 'vitest'
import { resolveFastSearchRequest } from './search-request-policy.js'

describe('resolveFastSearchRequest', () => {
  it('routes home input exclusively to preview search', () => {
    expect(resolveFastSearchRequest(true, 'search')).toBe('preview')
  })

  it('routes results input exclusively to full search', () => {
    expect(resolveFastSearchRequest(false, 'search')).toBe('full')
  })

  it('does not issue a request for blank input', () => {
    expect(resolveFastSearchRequest(true, '   ')).toBe('none')
    expect(resolveFastSearchRequest(false, '')).toBe('none')
  })
})
