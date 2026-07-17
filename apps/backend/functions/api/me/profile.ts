// PATCH /api/me/profile — non-binary profile fields (display_name,
// avatar_visible). Avatar bytes have their own endpoint (POST/DELETE
// /api/me/avatar) because multipart bodies don't compose cleanly with
// JSON ones.
//
// Both fields are nullable in the request body:
//   display_name: string | null    — null clears the override
//   avatar_visible: boolean        — false hides the provider avatar

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { validateDisplayName } from '../../../src/profile/display-name'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

interface Body {
  display_name?: string | null
  avatar_visible?: boolean
}

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)

    let body: Body
    try {
      body = (await ctx.request.json()) as Body
    } catch {
      throw new ApiError('BAD_REQUEST', 'invalid json')
    }

    const updates: { col: string; val: unknown }[] = []

    if ('display_name' in body) {
      if (body.display_name === null) {
        updates.push({ col: 'display_name', val: null })
      } else if (typeof body.display_name === 'string') {
        const r = validateDisplayName(body.display_name)
        if (!r.ok) throw new ApiError('UNPROCESSABLE', `display_name ${r.reason}`)
        updates.push({ col: 'display_name', val: r.value })
      } else {
        throw new ApiError('UNPROCESSABLE', 'display_name must be string or null')
      }
    }

    if ('avatar_visible' in body) {
      if (typeof body.avatar_visible !== 'boolean') {
        throw new ApiError('UNPROCESSABLE', 'avatar_visible must be boolean')
      }
      updates.push({ col: 'avatar_visible', val: body.avatar_visible ? 1 : 0 })
    }

    if (updates.length === 0) {
      return jsonOk({ ok: true, changed: 0 })
    }

    // Build a parameterised UPDATE — col names are from the
    // fixed set above (not user input) so concatenation is safe.
    const set = updates.map((u) => `${u.col}=?`).join(', ')
    const values = updates.map((u) => u.val)
    await ctx.env.DB
      .prepare(`UPDATE users SET ${set} WHERE id=?`)
      .bind(...values, user.id)
      .run()

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'profile.update',
      details: { fields: updates.map((u) => u.col) },
    })

    return jsonOk({ ok: true, changed: updates.length })
  } catch (e) {
    return jsonError(e)
  }
}
