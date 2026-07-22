import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  client: {
    listWebhookEndpoints: vi.fn(),
    updateWebhookEndpoint: vi.fn(),
    createWebhookEndpoint: vi.fn(),
  },
}))

vi.mock('../src/teams/workos-client', () => ({
  createWorkosTeamClient: () => mocks.client,
}))

import { onRequestPost as bootstrapWebhook } from '../functions/api/internal/workos/bootstrap-webhook'
import type { TeamApiEnv } from '../src/teams/env'
import { invoke } from './_helpers/ctx'
import { makeKv } from './_helpers/fakes'

const EVENTS = [
  'organization_membership.deleted',
  'organization_membership.updated',
  'organization.deleted',
  'user.deleted',
]

function env(token?: string): TeamApiEnv {
  return {
    DB: {} as D1Database,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    WORKOS_API_KEY: 'sk_test',
    PUBLIC_BASE_URL: 'https://spool.new',
    ...(token ? { WORKOS_BOOTSTRAP_TOKEN: token } : {}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.client.listWebhookEndpoints.mockResolvedValue([])
  mocks.client.createWebhookEndpoint.mockResolvedValue({
    id: 'we_1',
    endpoint_url: 'https://spool.new/api/webhooks/workos',
    secret: 'whsec_return_once',
    status: 'enabled',
    events: EVENTS,
  })
})

describe('temporary WorkOS webhook bootstrap', () => {
  it('is indistinguishable from a missing route when the temporary secret is absent', async () => {
    const response = await invoke(
      bootstrapWebhook,
      new Request('https://spool.new/api/internal/workos/bootstrap-webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer guess' },
      }),
      env(),
    )
    expect(response.status).toBe(404)
    expect(mocks.client.listWebhookEndpoints).not.toHaveBeenCalled()
  })

  it('creates only the fail-closed event set and returns the secret with no-store', async () => {
    const response = await invoke(
      bootstrapWebhook,
      new Request('https://spool.new/api/internal/workos/bootstrap-webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer bootstrap-token-test' },
      }),
      env('bootstrap-token-test'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ id: 'we_1', secret: 'whsec_return_once' })
    expect(mocks.client.createWebhookEndpoint).toHaveBeenCalledWith(
      'https://spool.new/api/webhooks/workos',
      EVENTS,
    )
  })

  it('repairs an existing endpoint instead of creating a duplicate', async () => {
    mocks.client.listWebhookEndpoints.mockResolvedValue([
      {
        id: 'we_existing',
        endpoint_url: 'https://spool.new/api/webhooks/workos',
        secret: 'whsec_existing',
        status: 'disabled',
        events: [],
      },
    ])
    mocks.client.updateWebhookEndpoint.mockResolvedValue({
      id: 'we_existing',
      endpoint_url: 'https://spool.new/api/webhooks/workos',
      secret: 'whsec_existing',
      status: 'enabled',
      events: EVENTS,
    })
    const response = await invoke(
      bootstrapWebhook,
      new Request('https://spool.new/api/internal/workos/bootstrap-webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer bootstrap-token-test' },
      }),
      env('bootstrap-token-test'),
    )
    expect(response.status).toBe(200)
    expect(mocks.client.updateWebhookEndpoint).toHaveBeenCalledWith(
      'we_existing',
      'https://spool.new/api/webhooks/workos',
      EVENTS,
    )
    expect(mocks.client.createWebhookEndpoint).not.toHaveBeenCalled()
  })

  it('derives staging registration from PUBLIC_BASE_URL without touching production', async () => {
    const bindings = env('bootstrap-token-test')
    bindings.PUBLIC_BASE_URL = 'https://staging.spool.new'
    const response = await invoke(
      bootstrapWebhook,
      new Request('https://staging.spool.new/api/internal/workos/bootstrap-webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer bootstrap-token-test' },
      }),
      bindings,
    )
    expect(response.status).toBe(200)
    expect(mocks.client.createWebhookEndpoint).toHaveBeenCalledWith(
      'https://staging.spool.new/api/webhooks/workos',
      EVENTS,
    )
  })

  it('rejects a non-origin or credentialed PUBLIC_BASE_URL', async () => {
    const bindings = env('bootstrap-token-test')
    bindings.PUBLIC_BASE_URL = 'https://user:pass@staging.spool.new/base'
    const response = await invoke(
      bootstrapWebhook,
      new Request('https://staging.spool.new/api/internal/workos/bootstrap-webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer bootstrap-token-test' },
      }),
      bindings,
    )
    expect(response.status).toBe(500)
    expect(mocks.client.createWebhookEndpoint).not.toHaveBeenCalled()
  })
})
