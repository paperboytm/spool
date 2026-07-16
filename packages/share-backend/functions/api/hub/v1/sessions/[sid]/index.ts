import type { PagesFunction } from '@cloudflare/workers-types'

import { requireReadableSession, type HubEnv } from '../../../../../../src/hub/head'
import { getHubAuthor } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'
import { jsonError, jsonOk } from '../../../../../../src/errors'

// Public head meta. Deliberately uncached (middleware defaults /api/ to
// no-store): a withdraw must take effect on the next load. The bulky,
// immutable parts (view, records) carry their own cache headers.

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const session = await requireReadableSession(ctx.env.DB, sid)
    const author = await getHubAuthor(ctx.env.DB, session.owner_user_id)
    return jsonOk({
      sid: session.sid,
      root: session.root,
      count: session.record_count,
      sig: session.sig,
      noteMd: session.note_md,
      cardJson: session.card_json,
      lineageJson: session.lineage_json,
      viewOid: session.view_oid,
      spoolFileOid: session.spool_file_oid,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      author,
    })
  } catch (e) {
    return jsonError(e)
  }
}
