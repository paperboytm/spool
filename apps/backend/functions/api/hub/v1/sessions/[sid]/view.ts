import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../../../../src/errors'
import {
  requireReadableSession,
  sessionContentCacheControl,
  type HubEnv,
} from '../../../../../../src/hub/head'
import { readObjects } from '../../../../../../src/hub/packs'
import { locateSessionObjects } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'

// The author-computed view object: content-addressed, so cacheable hard.
// Readers treat it as a layout hint — the diff pane recomputes from records,
// which is what keeps a tampered view honest.

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const session = await requireReadableSession(ctx.request, ctx.env, sid)
    const cacheControl = sessionContentCacheControl(session)
    const privateVary = session.visibility === 'private' ? { vary: 'Cookie, Authorization' } : {}
    if (!session.view_oid) throw new ApiError('NOT_FOUND', 'no view')

    const etag = `"${session.view_oid}"`
    if (ctx.request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, 'cache-control': cacheControl, ...privateVary },
      })
    }

    const located = await locateSessionObjects(ctx.env.DB, session, [session.view_oid])
    const location = located.get(session.view_oid)
    if (!location) throw new ApiError('INTERNAL', 'view object missing')
    const objects = await readObjects(ctx.env.HUB, [location])
    const body = objects.get(session.view_oid)
    if (body === undefined) throw new ApiError('INTERNAL', 'view object unreadable')

    return new Response(body, {
      headers: {
        'content-type': 'application/json',
        'cache-control': cacheControl,
        ...privateVary,
        etag,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
