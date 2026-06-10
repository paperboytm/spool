// Minimal in-process HTTP server that stands in for share-backend
// during e2e runs of the publish flow.
//
// Real share-backend is a Cloudflare Pages Functions project: D1, KV, R2,
// the OG render pipeline, scheduled deletion worker. Spinning that up in
// CI would require either a wrangler dev side-car (flaky, slow, and
// hard-coded to platform-specific binaries) or a full miniflare embed
// (drags in C++ workerd). Neither is worth the friction for a renderer
// regression suite.
//
// What we run instead: a tiny Node http server that speaks the exact wire
// contract `share-publish:*` IPC handlers expect — enough surface to
// exercise the Share popover, the publish form, the manage view, and the
// Published tab on SharesPage. State is kept in memory; per-test reset
// happens through the `reset()` method.
//
// What we deliberately do NOT cover here:
//   - PII gate enforcement (server-side rescan) — there isn't one; the
//     client gate is the only boundary, and that's tested in
//     publish-logic.test.ts
//   - Rate limiting — handled at the backend in prod; mocking realistic
//     rate-limit windows in a unit-sized server adds noise without
//     catching regressions in the renderer paths
//   - Real auth verification — every signed-in request is accepted; the
//     OAuth path is replaced at the IPC composition root by the e2e-mode
//     entry (src/main/e2e-mode/share-auth-e2e.ts), which never runs the
//     loopback dance or Google token exchange

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

export interface SharePublishMockState {
  user: {
    id: string
    email: string
    name: string
    avatar_url: string | null
    handle: string | null
    deletion_pending_until: number | null
  }
  /** Map<slug, share>. Maintained in publish/revoke/republish handlers
   *  so /api/me/shares returns the current view. */
  shares: Map<string, MockShareRow>
  /** Per-handle availability override; defaults to "available" if absent. */
  handleAvailability: Map<string, boolean>
  /** Last publish payload received — handy in assertions. */
  lastPublishPayload: Record<string, unknown> | null
  /** Forced failure statuses. When set, the matching route responds
   *  with that status (and an errors.ts-shaped body) instead of its
   *  normal handler — lets specs exercise the renderer's 401/429/5xx
   *  error surfaces without teaching the mock real rate limiting.
   *  Cleared by `reset()`; tests can also null them mid-test to
   *  exercise the retry path. */
  failures: {
    publish: number | null
    myShares: number | null
  }
}

export interface MockShareRow {
  id: string
  title: string
  visibility: 'unlisted' | 'profile-listed'
  expires_at: number | null
  version: number
  published_at: number
  republished_at: number | null
  revoked_at: number | null
  draft_id: string | null
  client_request_id: string | null
}

export interface SharePublishMockHandle {
  /** URL to set as SPOOL_SHARE_BACKEND for the Electron process. */
  baseUrl: string
  state: SharePublishMockState
  /** Clear in-memory state between tests without restarting the server. */
  reset: () => void
  close: () => Promise<void>
}

const DEFAULT_USER: SharePublishMockState['user'] = {
  id: 'mock-user-1',
  email: 'mock@example.com',
  name: 'E2E User',
  avatar_url: null,
  handle: null,
  deletion_pending_until: null,
}

export async function startSharePublishMockBackend(): Promise<SharePublishMockHandle> {
  const state: SharePublishMockState = {
    user: { ...DEFAULT_USER },
    shares: new Map(),
    handleAvailability: new Map(),
    lastPublishPayload: null,
    failures: { publish: null, myShares: null },
  }

  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, state)
    } catch (err) {
      // Defensive: any thrown error should surface as 500 rather than
      // leave the renderer's IPC hanging on a torn socket.
      //
      // Don't echo the raw error into the response body — CodeQL flags
      // `String(err)` as potential stack-trace exposure. Mock-backend
      // failures are debugger fodder; log to stderr where Playwright
      // pipes it into the test output, and keep the wire response
      // minimal.
      console.error('[share-publish-mock-backend] internal error:', err)
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'mock_internal' }))
    }
  })

  await new Promise<void>((resolve) => {
    // Bind to 127.0.0.1 (not 0.0.0.0) so other processes on a shared CI
    // runner can't accidentally connect — this stub accepts anything.
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const port = (server.address() as AddressInfo).port
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    baseUrl,
    state,
    reset: () => {
      state.user = { ...DEFAULT_USER }
      state.shares.clear()
      state.handleAvailability.clear()
      state.lastPublishPayload = null
      state.failures = { publish: null, myShares: null }
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: SharePublishMockState,
): Promise<void> {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const method = req.method ?? 'GET'

  // POST /api/auth/sign-in-with-id-token
  // The renderer's signIn IPC → e2e-mode's e2eSignIn() → here. We
  // accept any id_token payload (the e2e entry hard-codes the
  // 'e2e-fake-id-token' marker) and mint a session token.
  if (method === 'POST' && url.pathname === '/api/auth/sign-in-with-id-token') {
    await readBody(req)
    return json(res, 200, {
      session_token: 'mock-session-' + state.user.id,
      exp: Date.now() + 24 * 3600 * 1000,
      user: {
        id: state.user.id,
        email: state.user.email,
        name: state.user.name,
        avatar_url: state.user.avatar_url,
        handle: state.user.handle,
        deletion_pending_until: state.user.deletion_pending_until,
      },
    })
  }

  // POST /api/auth/sign-out
  if (method === 'POST' && url.pathname === '/api/auth/sign-out') {
    return json(res, 200, { ok: true })
  }

  // GET /api/me
  if (method === 'GET' && url.pathname === '/api/me') {
    return json(res, 200, {
      user: {
        id: state.user.id,
        email: state.user.email,
        name: state.user.name,
        avatar_url: state.user.avatar_url,
      },
      handle: state.user.handle,
      deletion_pending_until: state.user.deletion_pending_until,
    })
  }

  // GET /api/me/shares — backend returns { items: [...] } per the
  // /api/me/shares contract (not { shares: [...] }), and so the
  // renderer's MySharesResponse expects.
  if (method === 'GET' && url.pathname === '/api/me/shares') {
    if (state.failures.myShares !== null) {
      return json(res, state.failures.myShares, { error: 'forced_failure' })
    }
    const items = Array.from(state.shares.values()).map((s) => ({
      id: s.id,
      title: s.title,
      visibility: s.visibility,
      expires_at: s.expires_at,
      version: s.version,
      published_at: s.published_at,
      republished_at: s.republished_at,
      revoked_at: s.revoked_at,
      draft_id: s.draft_id,
      client_request_id: s.client_request_id,
    }))
    return json(res, 200, { items })
  }

  // GET /api/handles/check?h=foo — backend uses ?h not ?handle
  // (see share-backend/functions/api/handles/check.ts:11)
  if (method === 'GET' && url.pathname === '/api/handles/check') {
    const handle = url.searchParams.get('h') ?? ''
    if (!/^[a-z0-9_-]{3,32}$/.test(handle)) {
      return json(res, 422, { detail: 'invalid handle' })
    }
    const available = state.handleAvailability.get(handle) ?? true
    return json(res, 200, { handle, available })
  }

  // POST /api/handles/claim — body { handle }
  if (method === 'POST' && url.pathname === '/api/handles/claim') {
    const body = JSON.parse(await readBody(req)) as { handle?: string }
    const h = body.handle ?? ''
    if (!/^[a-z0-9_-]{3,32}$/.test(h)) return json(res, 422, { detail: 'invalid' })
    if (state.handleAvailability.get(h) === false) {
      return json(res, 409, { detail: 'taken' })
    }
    state.user.handle = h
    return json(res, 200, { handle: h })
  }

  // POST /api/publish — body { snapshot, visibility, draft_id,
  // idempotency_key, expires_at?, override_slug? }
  if (method === 'POST' && url.pathname === '/api/publish') {
    if (state.failures.publish !== null) {
      // errors.ts-shaped body; the renderer branches on status alone
      // for 401/429 but falls back to `detail` for other codes.
      return json(res, state.failures.publish, {
        error: 'forced_failure',
        detail: 'forced failure (e2e)',
      })
    }
    const body = JSON.parse(await readBody(req)) as PublishBody
    state.lastPublishPayload = body as unknown as Record<string, unknown>
    const overrideSlug = body.override_slug
    const draftId = body.draft_id ?? null
    const idemp = body.idempotency_key
    const visibility = body.visibility
    const title = body.snapshot?.conversation?.title ?? 'Untitled'
    const expiresAt = body.expires_at ? new Date(body.expires_at).getTime() : null

    // Idempotency short-circuit: if a non-revoked share carries the
    // same token, return that result without mutating state.
    for (const s of state.shares.values()) {
      if (
        s.client_request_id &&
        s.client_request_id === idemp &&
        s.revoked_at === null &&
        (!overrideSlug || s.id === overrideSlug)
      ) {
        return json(res, 200, {
          id: s.id,
          version: s.version,
          url: `https://mock.spool.pro/s/${s.id}`,
        })
      }
    }

    let slug: string
    let version: number
    if (overrideSlug) {
      const existing = state.shares.get(overrideSlug)
      if (!existing || existing.revoked_at !== null) {
        return json(res, 404, { detail: 'not found' })
      }
      slug = existing.id
      version = existing.version + 1
      state.shares.set(slug, {
        ...existing,
        title,
        visibility,
        expires_at: expiresAt,
        version,
        republished_at: Date.now(),
        draft_id: draftId,
        client_request_id: idemp,
      })
    } else {
      slug = randomSlug()
      version = 1
      state.shares.set(slug, {
        id: slug,
        title,
        visibility,
        expires_at: expiresAt,
        version,
        published_at: Date.now(),
        republished_at: null,
        revoked_at: null,
        draft_id: draftId,
        client_request_id: idemp,
      })
    }
    return json(res, 200, {
      id: slug,
      version,
      url: `https://mock.spool.pro/s/${slug}`,
    })
  }

  // PATCH /api/me/shares/:id — visibility change. Mirrors the real
  // handler's gates: 404 unknown, 410 revoked, 422 bad value or
  // profile-listed without a handle.
  const visMatch = method === 'PATCH' && url.pathname.match(/^\/api\/me\/shares\/([\w-]+)$/)
  if (visMatch) {
    const id = visMatch[1] as string
    const row = state.shares.get(id)
    if (!row) return json(res, 404, { detail: 'not found' })
    if (row.revoked_at !== null) return json(res, 410, { detail: 'gone' })
    const body = JSON.parse(await readBody(req)) as { visibility?: string }
    if (body.visibility !== 'unlisted' && body.visibility !== 'profile-listed') {
      return json(res, 422, { detail: 'invalid visibility' })
    }
    if (body.visibility === 'profile-listed' && !state.user.handle) {
      return json(res, 422, { detail: 'profile-listed requires a handle' })
    }
    state.shares.set(id, { ...row, visibility: body.visibility })
    return json(res, 200, { ok: true, visibility: body.visibility })
  }

  // POST /api/revoke/:id
  const revokeMatch = method === 'POST' && url.pathname.match(/^\/api\/revoke\/([\w-]+)$/)
  if (revokeMatch) {
    const id = revokeMatch[1] as string
    const row = state.shares.get(id)
    if (!row) return json(res, 404, { detail: 'not found' })
    if (row.revoked_at !== null) {
      // Idempotent — matches the backend's post-#369 contract.
      return json(res, 200, { ok: true })
    }
    state.shares.set(id, { ...row, revoked_at: Date.now() })
    return json(res, 200, { ok: true })
  }

  // POST /api/me/delete
  if (method === 'POST' && url.pathname === '/api/me/delete') {
    state.user.deletion_pending_until = Date.now() + 24 * 3600 * 1000
    return json(res, 200, { deletion_pending_until: state.user.deletion_pending_until })
  }
  if (method === 'DELETE' && url.pathname === '/api/me/delete') {
    state.user.deletion_pending_until = null
    return json(res, 200, { ok: true })
  }

  // Fallthrough — unknown route. Surface as 404 so a missing handler
  // shows up as a clear test failure rather than a hang or 500.
  json(res, 404, { detail: 'mock_unhandled', path: url.pathname, method })
}

interface PublishBody {
  snapshot: { conversation?: { title?: string } }
  visibility: 'unlisted' | 'profile-listed'
  draft_id?: string
  idempotency_key: string
  expires_at?: string
  override_slug?: string
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  // Same anti-cache discipline the real backend ships under
  // _middleware.ts — keeps the mock realistic so a "depends on a cached
  // response" regression doesn't sneak past locally and explode in prod.
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk) => {
      buf += chunk
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

const SLUG_ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
function randomSlug(): string {
  let out = ''
  for (let i = 0; i < 21; i++) {
    out += SLUG_ALPHA[Math.floor(Math.random() * SLUG_ALPHA.length)]
  }
  return out
}
