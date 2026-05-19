import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { CC_PRIVATE_NO_CACHE } from '../../../src/security/cache-control'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  ADMIN_USER_IDS?: string
}

const LIMIT = 200

function isAdmin(userId: string, raw: string | undefined): boolean {
  if (!raw) return false
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(userId)
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    if (!isAdmin(user.id, ctx.env.ADMIN_USER_IDS)) {
      throw new ApiError('FORBIDDEN')
    }
    const rows = await ctx.env.DB
      .prepare(
        'SELECT user_id, ip_hash, ua_hash, action, target_id, details_json, ts ' +
          'FROM audit_log ORDER BY ts DESC LIMIT ?',
      )
      .bind(LIMIT)
      .all()
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'admin.audit.read',
    })
    return jsonOk(
      { items: rows.results },
      { headers: { 'cache-control': CC_PRIVATE_NO_CACHE } },
    )
  } catch (e) {
    return jsonError(e)
  }
}
