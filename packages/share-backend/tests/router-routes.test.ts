// Route-table guard for the spool.pro dispatcher (same cross-package
// pattern as deletion-worker-deploy.test.ts). The one behavior the v2
// share flow adds: /session/* must reach share-web, not the landing page.

import { describe, expect, it } from 'vitest'

import { routeFor } from '../../../workers/spool-pro-router/src/worker'

describe('spool-pro-router routeFor', () => {
  it('routes v2 session pages to share-web', () => {
    expect(routeFor('/session/claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b')).toBe('web')
    expect(routeFor('/session/codex_abcd1234')).toBe('web')
  })

  it('keeps the existing table intact', () => {
    expect(routeFor('/api/hub/v1/sessions/x')).toBe('backend')
    expect(routeFor('/s/abcdefghijklmnopqrstu')).toBe('web')
    expect(routeFor('/@handle')).toBe('web')
    expect(routeFor('/me')).toBe('web')
    expect(routeFor('/')).toBe('landing')
    expect(routeFor('/blog/post')).toBe('landing')
  })
})
