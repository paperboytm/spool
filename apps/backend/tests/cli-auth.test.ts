// CLI-auth broker: start → approve (web session) → poll claims a sph_
// token exactly once. Runs the real handlers against in-memory fakes.

import { describe, expect, it } from 'vite-plus/test'

import {
  onRequestGet as approveGet,
  onRequestPost as approvePost,
} from '../functions/api/cli-auth/approve'
import { onRequestPost as pollPost } from '../functions/api/cli-auth/poll'
import {
  CLI_AUTH_START_RATE_MAX,
  CLI_AUTH_START_RATE_WINDOW_SEC,
  onRequestPost as startPost,
} from '../functions/api/cli-auth/start'
import { createSession } from '../src/auth/session'
import { normalizeUserCode } from '../src/cli-auth'
import { sha256Hex } from '../src/hub/auth'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

function envFor(dbState?: FakeDbState) {
  const { db, state } = makeDb(dbState)
  return {
    DB: db,
    SESSIONS: makeKv(),
    NONCE: makeKv(),
    RATE: makeKv(),
    state,
  }
}

function stateWithUser(id = 'u1'): FakeDbState {
  const state = emptyState()
  state.users.push({
    id,
    email: 'u@example.com',
    name: 'U',
    avatar_url: null,
    created_at: 1,
    last_signin_at: 1,
    deletion_pending_until: null,
    deleted_at: null,
  })
  return state
}

type Env = ReturnType<typeof envFor>

async function sessionCookie(env: Env, userId = 'u1'): Promise<string> {
  const sess = await createSession(env.SESSIONS, userId)
  return `spool_session=${sess.token}`
}

async function startRequest(env: Env, label = 'devbox.local') {
  const req = new Request('https://spool.new/api/cli-auth/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  const res = await invoke(startPost, req, env)
  expect(res.status).toBe(200)
  return (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
}

async function approveRequest(
  env: Env,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const req = new Request('https://spool.new/api/cli-auth/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  return invoke(approvePost, req, env)
}

async function pollRequest(env: Env, deviceCode: string): Promise<Response> {
  const req = new Request('https://spool.new/api/cli-auth/poll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
  })
  return invoke(pollPost, req, env)
}

describe('user_code normalization', () => {
  it('accepts case / separator sloppiness, rejects junk', () => {
    expect(normalizeUserCode('xkcd-2941')).toBe('XKCD-2941')
    expect(normalizeUserCode('XKCD 2941')).toBe('XKCD-2941')
    expect(normalizeUserCode('xkcd2941')).toBe('XKCD-2941')
    expect(normalizeUserCode('nope')).toBeNull()
    expect(normalizeUserCode('')).toBeNull()
    expect(normalizeUserCode('XKCD-2941-EXTRA')).toBeNull()
  })
})

describe('POST /api/cli-auth/start', () => {
  it('mints device_code + user_code + verification URL', async () => {
    const env = envFor()
    const body = await startRequest(env)
    expect(body.device_code.length).toBeGreaterThanOrEqual(43)
    expect(body.user_code).toMatch(/^[BCDFGHJKMNPQRSTWXZ2-9]{4}-[BCDFGHJKMNPQRSTWXZ2-9]{4}$/)
    expect(body.verification_uri).toBe(
      `https://spool.new/cli-auth?code=${encodeURIComponent(body.user_code)}`,
    )
    expect(body.expires_in).toBe(15 * 60)
    expect(body.interval).toBe(3)
  })

  it('429 once the per-IP window is exhausted', async () => {
    const env = envFor()
    const slot = Math.floor(Date.now() / 1000 / CLI_AUTH_START_RATE_WINDOW_SEC)
    await env.RATE.put(`rate/cli-auth-start/1.2.3.4/${slot}`, String(CLI_AUTH_START_RATE_MAX), {
      expirationTtl: CLI_AUTH_START_RATE_WINDOW_SEC,
    })
    const req = new Request('https://spool.new/api/cli-auth/start', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    })
    const res = await invoke(startPost, req, env)
    expect(res.status).toBe(429)
  })
})

describe('GET /api/cli-auth/approve (page metadata)', () => {
  it('401 without a session', async () => {
    const env = envFor()
    const { user_code } = await startRequest(env)
    const req = new Request(`https://spool.new/api/cli-auth/approve?code=${user_code}`)
    const res = await invoke(approveGet, req, env)
    expect(res.status).toBe(401)
  })

  it('returns label + code for a signed-in user, tolerant of lowercase', async () => {
    const env = envFor(stateWithUser())
    const cookie = await sessionCookie(env)
    const { user_code } = await startRequest(env)
    const req = new Request(
      `https://spool.new/api/cli-auth/approve?code=${user_code.toLowerCase()}`,
      { headers: { cookie } },
    )
    const res = await invoke(approveGet, req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user_code: string; label: string }
    expect(body.user_code).toBe(user_code)
    expect(body.label).toBe('devbox.local')
  })

  it('404 on an unknown code', async () => {
    const env = envFor(stateWithUser())
    const cookie = await sessionCookie(env)
    const req = new Request('https://spool.new/api/cli-auth/approve?code=BBBB-BBBB', {
      headers: { cookie },
    })
    const res = await invoke(approveGet, req, env)
    expect(res.status).toBe(404)
  })
})

describe('approve → poll happy path', () => {
  it('hands the token out exactly once and records the audit trail', async () => {
    const env = envFor(stateWithUser())
    const cookie = await sessionCookie(env)
    const { device_code, user_code } = await startRequest(env)

    // Pending before approval.
    const pending = await pollRequest(env, device_code)
    expect(pending.status).toBe(200)
    expect(await pending.json()).toEqual({ status: 'pending', interval: 3 })

    const approved = await approveRequest(env, cookie, {
      user_code,
      decision: 'approve',
    })
    expect(approved.status).toBe(200)

    const claim = await pollRequest(env, device_code)
    expect(claim.status).toBe(200)
    const claimBody = (await claim.json()) as { status: string; token: string }
    expect(claimBody.status).toBe('approved')
    expect(claimBody.token).toMatch(/^sph_[0-9a-f]{64}$/)

    // The stored hash matches the claimed token, bound to the approver.
    expect(env.state.api_tokens).toHaveLength(1)
    expect(env.state.api_tokens[0]).toMatchObject({
      user_id: 'u1',
      token_hash: await sha256Hex(claimBody.token),
      label: 'cli: devbox.local',
    })
    expect(env.state.audit).toEqual([
      expect.objectContaining({ user_id: 'u1', action: 'cli-auth.approve' }),
    ])

    // Single claim: the same device_code is dead now.
    const replay = await pollRequest(env, device_code)
    expect(replay.status).toBe(404)
  })

  it('approval is single-use per user_code too', async () => {
    const env = envFor(stateWithUser())
    const cookie = await sessionCookie(env)
    const { user_code } = await startRequest(env)
    const first = await approveRequest(env, cookie, { user_code, decision: 'approve' })
    expect(first.status).toBe(200)
    const second = await approveRequest(env, cookie, { user_code, decision: 'approve' })
    expect(second.status).toBe(404)
    expect(env.state.api_tokens).toHaveLength(1)
  })
})

describe('deny + failure modes', () => {
  it('deny kills the request without minting anything', async () => {
    const env = envFor(stateWithUser())
    const cookie = await sessionCookie(env)
    const { device_code, user_code } = await startRequest(env)
    const res = await approveRequest(env, cookie, { user_code, decision: 'deny' })
    expect(res.status).toBe(200)
    expect(env.state.api_tokens).toHaveLength(0)
    const poll = await pollRequest(env, device_code)
    expect(poll.status).toBe(404)
    expect(env.state.audit).toEqual([
      expect.objectContaining({ user_id: 'u1', action: 'cli-auth.deny' }),
    ])
  })

  it('401 approving without a session', async () => {
    const env = envFor(stateWithUser())
    const { user_code } = await startRequest(env)
    const req = new Request('https://spool.new/api/cli-auth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_code, decision: 'approve' }),
    })
    const res = await invoke(approvePost, req, env)
    expect(res.status).toBe(401)
    expect(env.state.api_tokens).toHaveLength(0)
  })

  it('an API token cannot approve (session-only, like token minting)', async () => {
    // requireUser only accepts KV sessions; a Bearer sph_ token is
    // rejected even when it exists in api_tokens.
    const state = stateWithUser()
    state.api_tokens.push({
      id: 't1',
      user_id: 'u1',
      token_hash: await sha256Hex('sph_existing'),
      label: null,
      created_at: 1,
      last_used_at: null,
    })
    const env = envFor(state)
    const { user_code } = await startRequest(env)
    const req = new Request('https://spool.new/api/cli-auth/approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sph_existing',
      },
      body: JSON.stringify({ user_code, decision: 'approve' }),
    })
    const res = await invoke(approvePost, req, env)
    expect(res.status).toBe(401)
    expect(env.state.api_tokens).toHaveLength(1)
  })

  it('429 when the shared daily token-mint budget is spent', async () => {
    const env = envFor(stateWithUser())
    const cookie = await sessionCookie(env)
    const { user_code } = await startRequest(env)
    const slot = Math.floor(Date.now() / 1000 / 86400)
    await env.RATE.put(`rate/hub-token-d/u1/${slot}`, '10', { expirationTtl: 86400 })
    const res = await approveRequest(env, cookie, { user_code, decision: 'approve' })
    expect(res.status).toBe(429)
    expect(env.state.api_tokens).toHaveLength(0)
  })

  it('poll 400s without a device_code and 404s on garbage', async () => {
    const env = envFor()
    const bad = await invoke(
      pollPost,
      new Request('https://spool.new/api/cli-auth/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    )
    expect(bad.status).toBe(400)
    const unknown = await pollRequest(env, 'not-a-real-device-code-aaaaaaaaaaaaaaaaaaaa')
    expect(unknown.status).toBe(404)
  })
})
