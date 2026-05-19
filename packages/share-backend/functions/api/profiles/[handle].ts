import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { validateHandle } from '../../../src/handles'

type Env = { DB: D1Database; SESSIONS: KVNamespace }

type Row = {
  name: string | null
  avatar_url: string | null
}

type ShareRow = {
  id: string
  title: string
  published_at: number
  version: number
}

const SHARE_LIMIT = 100

export const onRequestGet: PagesFunction<Env, 'handle'> = async (ctx) => {
  try {
    const raw = ctx.params.handle
    const v = validateHandle(typeof raw === 'string' ? raw : '')
    // 404 (not 422) so we never leak which handles are merely invalid vs missing.
    if (!v.ok) throw new ApiError('NOT_FOUND')

    const owner = await ctx.env.DB
      .prepare(
        'SELECT u.id AS user_id, u.name AS name, u.avatar_url AS avatar_url ' +
          'FROM handles h JOIN users u ON u.id = h.user_id ' +
          'WHERE h.handle = ? AND h.released_at IS NULL AND u.deleted_at IS NULL',
      )
      .bind(v.handle)
      .first<Row & { user_id: string }>()
    if (!owner) throw new ApiError('NOT_FOUND')

    const now = Date.now()
    const shares = await ctx.env.DB
      .prepare(
        'SELECT id, title, published_at, version FROM published_shares ' +
          'WHERE user_id = ? AND visibility = ? AND revoked_at IS NULL ' +
          'AND (expires_at IS NULL OR expires_at > ?) ' +
          'ORDER BY published_at DESC LIMIT ?',
      )
      .bind(owner.user_id, 'profile-listed', now, SHARE_LIMIT)
      .all<ShareRow>()

    return jsonOk(
      {
        handle: v.handle,
        name: owner.name,
        avatar_url: owner.avatar_url,
        shares: shares.results,
      },
      {
        headers: { 'cache-control': 'public, max-age=30, must-revalidate' },
      },
    )
  } catch (e) {
    return jsonError(e)
  }
}
