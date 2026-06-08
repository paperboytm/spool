import { describe, expect, it } from 'vitest'

import { onRequestGet as avatarGet } from '../functions/api/avatars/[id]'

import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeR2 } from './_helpers/fakes'

function envFor() {
  const { db, state } = makeDb(emptyState())
  const avatars = makeR2()
  return {
    DB: db,
    AVATARS: avatars.bucket,
    state,
    _avatars: avatars.store,
  }
}

function seedUserWithAvatar(
  env: ReturnType<typeof envFor>,
  opts: { id?: string; customId?: string | null; visible?: number } = {},
): void {
  const id = opts.id ?? 'user-123abc'
  env.state.users.push({
    id,
    email: `${id}@example.com`,
    name: id,
    avatar_url: null,
    custom_avatar_id: opts.customId ?? 'abcd1234.png',
    avatar_visible: opts.visible ?? 1,
    created_at: Date.now(),
    last_signin_at: Date.now(),
    deletion_pending_until: null,
    deleted_at: null,
  })
}

describe('GET /api/avatars/:user_id', () => {
  it('serves the R2 object with image content-type when a custom avatar is set', async () => {
    const env = envFor()
    seedUserWithAvatar(env)
    await env.AVATARS.put('avatars/user-123abc/abcd1234.png', new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: 'image/png' },
    })

    const res = await invoke(
      avatarGet,
      new Request('https://x/api/avatars/user-123abc'),
      env,
      { id: 'user-123abc' },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('etag')).toBe('"abcd1234.png"')
  })

  it('404s when the user has no custom avatar set', async () => {
    const env = envFor()
    seedUserWithAvatar(env, { customId: null })

    const res = await invoke(
      avatarGet,
      new Request('https://x/api/avatars/user-123abc'),
      env,
      { id: 'user-123abc' },
    )
    expect(res.status).toBe(404)
  })

  it('404s when avatar_visible=0 even though the R2 object exists', async () => {
    // /api/me + /api/profiles already gate the URL on this flag.
    // Without the same check here, anyone holding a stale URL bypasses
    // the user's privacy toggle by hitting the raw endpoint.
    const env = envFor()
    seedUserWithAvatar(env, { visible: 0 })
    await env.AVATARS.put('avatars/user-123abc/abcd1234.png', new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: 'image/png' },
    })

    const res = await invoke(
      avatarGet,
      new Request('https://x/api/avatars/user-123abc'),
      env,
      { id: 'user-123abc' },
    )
    expect(res.status).toBe(404)
  })

  it('404s on malformed user_id (path traversal guard)', async () => {
    const env = envFor()
    const res = await invoke(
      avatarGet,
      new Request('https://x/api/avatars/..%2Fetc%2Fpasswd'),
      env,
      { id: '../etc/passwd' },
    )
    expect(res.status).toBe(404)
  })
})
