import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../../../../src/errors'
import { requireReadableSession, type HubEnv } from '../../../../../../src/hub/head'
import { readObjects } from '../../../../../../src/hub/packs'
import { locateObjects } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'

// The attached .spool document (curated publication artifact) — served
// exactly like the view object: content-addressed, immutable-cached.

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const session = await requireReadableSession(ctx.env.DB, sid)
    if (!session.spool_file_oid) throw new ApiError('NOT_FOUND', 'no spool file')

    const etag = `"${session.spool_file_oid}"`
    if (ctx.request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag } })
    }

    const located = await locateObjects(ctx.env.DB, session.owner_user_id, [session.spool_file_oid])
    const location = located.get(session.spool_file_oid)
    if (!location) throw new ApiError('INTERNAL', 'spool file object missing')
    const objects = await readObjects(ctx.env.HUB, [location])
    const body = objects.get(session.spool_file_oid)
    if (body === undefined) throw new ApiError('INTERNAL', 'spool file unreadable')

    return new Response(body, {
      headers: {
        'content-type': 'application/spool+json',
        'cache-control': 'public, max-age=3600',
        etag,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
