import { afterEach, describe, expect, it } from 'vite-plus/test'

import { backendUrl, DEFAULT_BACKEND } from './backend-url.js'

const originalBackend = process.env['SPOOL_SHARE_BACKEND']

afterEach(() => {
  if (originalBackend === undefined) delete process.env['SPOOL_SHARE_BACKEND']
  else process.env['SPOOL_SHARE_BACKEND'] = originalBackend
})

describe('backendUrl', () => {
  it('uses spool.new as the production backend', () => {
    delete process.env['SPOOL_SHARE_BACKEND']
    expect(DEFAULT_BACKEND).toBe('https://spool.new')
    expect(backendUrl()).toBe('https://spool.new')
  })

  it('keeps explicit local and staging overrides', () => {
    process.env['SPOOL_SHARE_BACKEND'] = 'https://staging.spool.new'
    expect(backendUrl()).toBe('https://staging.spool.new')
  })
})
