import { describe, expect, it, vi } from 'vite-plus/test'

import { routeFor, routeRequest } from './edge-router'

describe('edge router', () => {
  it('routes only /api/* paths to the backend', () => {
    expect(routeFor('/api/hub/v1/sessions/x')).toBe('backend')
    expect(routeFor('/api/health')).toBe('backend')
    expect(routeFor('/api')).toBe('web')
    expect(routeFor('/apifoo')).toBe('web')
    expect(routeFor('/session/claude_12345678')).toBe('web')
    expect(routeFor('/')).toBe('web')
  })

  it('forwards API requests without buffering their response', async () => {
    const webFetch = vi.fn(async () => new Response('web'))
    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://spool-share-backend.pages.dev/api/health?full=1')
      expect(request.method).toBe('POST')
      expect(request.headers.get('authorization')).toBe('Bearer test')
      expect(request.headers.get('x-forwarded-host')).toBe('spool.new')
      expect(request.headers.get('x-forwarded-proto')).toBe('https')
      expect(await request.text()).toBe('payload')
      return new Response('api', { status: 201, headers: { 'x-upstream': 'backend' } })
    })
    const request = new Request('https://spool.new/api/health?full=1', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: 'payload',
    })

    const response = await routeRequest(
      request,
      'https://spool-share-backend.pages.dev',
      webFetch,
      upstreamFetch,
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('x-upstream')).toBe('backend')
    expect(response.headers.get('x-spool-route')).toBe('backend')
    expect(await response.text()).toBe('api')
    expect(webFetch).not.toHaveBeenCalled()
  })

  it('passes web requests to TanStack Start unchanged', async () => {
    const request = new Request('https://spool.new/docs/installation')
    const webFetch = vi.fn(async (received: Request) => {
      expect(received).toBe(request)
      return new Response('page', { headers: { 'cache-control': 'public, max-age=60' } })
    })
    const upstreamFetch = vi.fn(async () => new Response('unexpected'))

    const response = await routeRequest(
      request,
      'https://spool-share-backend.pages.dev',
      webFetch,
      upstreamFetch,
    )

    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('x-spool-route')).toBe('web')
    expect(await response.text()).toBe('page')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
})
