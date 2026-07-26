import type { PagesFunction } from '@cloudflare/workers-types'

import {
  filterLineageForAudience,
  isPublishedToDiscovery,
} from '../../../../../../src/discovery/projection'
import { jsonError, jsonOk } from '../../../../../../src/errors'
import { optionalHubUser } from '../../../../../../src/hub/auth'
import { getSessionGuidance } from '../../../../../../src/hub/guidance'
import {
  activeTeamRole,
  isTeamOnlySession,
  requireReadableSession,
  type HubEnv,
} from '../../../../../../src/hub/head'
import { getHubAuthor } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'
import { getProjectById, serializeProject } from '../../../../../../src/projects/store'

// Public head meta. Deliberately uncached (middleware defaults /api/ to
// no-store): a withdraw must take effect on the next load. The bulky,
// immutable parts (view, records) carry their own cache headers.

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const session = await requireReadableSession(ctx.request, ctx.env, sid)
    const teamOnly = isTeamOnlySession(session)
    const published = teamOnly ? false : await isPublishedToDiscovery(ctx.env.DB, sid)
    const optionalReader =
      session.team_id !== null && !teamOnly ? await optionalHubUser(ctx.request, ctx.env) : null
    const isCurrentTeamMember =
      session.team_id !== null &&
      optionalReader !== null &&
      (await activeTeamRole(ctx.env.DB, session.team_id, optionalReader.id)) !== null
    // A public Team-owned Session creates the Project's deliberately bounded
    // public projection. Team-only and Link-only Sessions never do so by
    // themselves; current members retain full tenant context.
    const exposeProject = session.team_id === null || teamOnly || published || isCurrentTeamMember
    const [author, projectRow] = await Promise.all([
      getHubAuthor(ctx.env.DB, session.owner_user_id),
      exposeProject
        ? getProjectById(ctx.env.DB, session.project_id, { includeArchived: true })
        : Promise.resolve(null),
    ])
    if (exposeProject && !projectRow) throw new Error('Session Project missing')
    const team = session.team_id
      ? await ctx.env.DB.prepare('SELECT id, name FROM teams WHERE id=? AND archived_at IS NULL')
          .bind(session.team_id)
          .first<{ id: string; name: string }>()
      : null
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
        project: projectRow ? await serializeProject(ctx.env.DB, projectRow) : null,
        author,
      },
      session.team_id !== null
        ? { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } }
        : undefined,
    )
  } catch (e) {
    return jsonError(e)
  }
}
