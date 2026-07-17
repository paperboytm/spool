// Route-table guard for the spool.pro dispatcher (same cross-package
// pattern as deletion-worker-deploy.test.ts). Since the landing/share
// merge the table is two-way: /api/* to the backend, everything else —
// marketing pages, docs, readers, account pages — to the merged web
// app (apps/web).

import { describe, expect, it } from 'vitest'

import { routeFor } from '../../../workers/spool-pro-router/src/worker'

describe('spool-pro-router routeFor', () => {
  it('routes the API to the backend', () => {
    expect(routeFor('/api/hub/v1/sessions/x')).toBe('backend')
    expect(routeFor('/api/cli-auth/start')).toBe('backend')
    expect(routeFor('/api/meta/abc')).toBe('backend')
  })

  it('routes every page surface to the merged web app', () => {
    // Readers + account pages (the old share-web surface).
    expect(routeFor('/session/claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b')).toBe('web')
    expect(routeFor('/s/abcdefghijklmnopqrstu')).toBe('web')
    expect(routeFor('/@handle')).toBe('web')
    expect(routeFor('/me')).toBe('web')
    expect(routeFor('/cli-auth')).toBe('web')
    // Marketing surface (the old landing site).
    expect(routeFor('/')).toBe('web')
    expect(routeFor('/blog/post')).toBe('web')
    expect(routeFor('/docs/installation')).toBe('web')
  })

  it('does not treat an /api prefix without the trailing slash as backend', () => {
    // '/api' alone has no handler upstream; the web app's tombstone is
    // a friendlier dead-end than the backend's bare 404.
    expect(routeFor('/apifoo')).toBe('web')
  })
})
