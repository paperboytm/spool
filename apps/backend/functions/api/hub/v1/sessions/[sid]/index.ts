import type { PagesFunction } from '@cloudflare/workers-types'

import {
  filterLineageForAudience,
  isPublishedToDiscovery,
} from '../../../../../../src/discovery/projection'
import { jsonError, jsonOk } from '../../../../../../src/errors'
import { getSessionGuidance } from '../../../../../../src/hub/guidance'
import {
  isTeamOnlySession,
  requireReadableSession,
  type HubEnv,
} from '../../../../../../src/hub/head'
import { getHubAuthor } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'

// Public head meta. Deliberately uncached (middleware defaults /api/ to
// no-store): a withdraw must take effect on the next load. The bulky,
// immutable parts (view, records) carry their own cache headers.

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const session = await requireReadableSession(ctx.request, ctx.env, sid)
    const author = await getHubAuthor(ctx.env.DB, session.owner_user_id)
    const team = session.team_id
      ? await ctx.env.DB.prepare('SELECT id, name FROM teams WHERE id=? AND archived_at IS NULL')
          .bind(session.team_id)
          .first<{ id: string; name: string }>()
      : null
    const teamOnly = isTeamOnlySession(session)
    const published = teamOnly ? false : await isPublishedToDiscovery(ctx.env.DB, sid)
    const summaryMd = session.note_md
    const guidance = await getSessionGuidance(ctx.env.DB, session)
    const lineageJson = await filterLineageForAudience(
      ctx.env.DB,
      session.lineage_json,
      teamOnly ? session.team_id : null,
    )
    return jsonOk(
      {
        sid: session.sid,
        root: session.root,
        count: session.record_count,
        sig: session.sig,
        summaryMd,
        // Rolling-upgrade alias for older CLI/Desktop/Web clients.
        noteMd: summaryMd,
        cardJson: session.card_json,
        lineageJson,
        viewOid: session.view_oid,
        guidance,
        spoolFileOid: session.spool_file_oid,
        cost:
          session.total_tokens !== null && session.total_tokens > 0
            ? { usd: session.cost_usd, totalTokens: session.total_tokens }
            : null,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        visibility: teamOnly ? 'team' : published ? 'public' : 'link-only',
        team,
        author,
      },
      teamOnly
        ? { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } }
        : undefined,
    )
  } catch (e) {
    return jsonError(e)
  }
}
