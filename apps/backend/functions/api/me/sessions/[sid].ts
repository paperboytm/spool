import type { PagesFunction } from '@cloudflare/workers-types'
import { isDiscoverySessionSid } from '@spool-lab/session-kit'
import { z } from 'zod'

import { auditAfterCommit } from '../../../../src/audit-after-commit'
import {
  buildDiscoveryProjection,
  filterLineageForAudience,
  isPublishedToDiscovery,
  prepareAuthorizedDiscoveryProjectionDelete,
  prepareAuthorizedDiscoveryProjectionUpsert,
  prepareAuthorizedEngagementDelete,
  readDiscoveryView,
} from '../../../../src/discovery/projection'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { requireHubUser } from '../../../../src/hub/auth'
import { activeTeamRole, type HubEnv } from '../../../../src/hub/head'
import { serializeManagedSession } from '../../../../src/hub/management'
import { readManifest } from '../../../../src/hub/packs'
import {
  getHubSession,
  isTeamStorageQuotaError,
  personalObjectBytes,
  prepareAuthorizedPersonalObjectAliases,
  prepareAuthorizedVisibilityUpdate,
  presentOids,
  presentTeamOids,
  teamStorageBytes,
} from '../../../../src/hub/store'
import { requireSid, TEAM_ID_RE, TEAM_QUOTA_BYTES } from '../../../../src/hub/wire'
import { checkRate } from '../../../../src/rate-limit'

const VisibilityBody = z
  .object({
    visibility: z.enum(['public', 'link-only', 'team']),
    team_id: z.string().regex(TEAM_ID_RE).nullable().optional(),
  })
  .strict()

export const onRequestPatch: PagesFunction<HubEnv, 'sid'> = async (ctx) => {
  try {
    // Disclosure changes are a named CLI action too (`spool visibility`), so
    // accept the hub API token in addition to the web session.
    const user = await requireHubUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params.sid)
    const body = VisibilityBody.safeParse(await readJson(ctx.request))
    if (!body.success) {
      throw new ApiError('UNPROCESSABLE', 'invalid visibility', { issues: body.error.issues })
    }

    const session = await getHubSession(ctx.env.DB, sid)
    if (!session) throw new ApiError('NOT_FOUND')
    let targetRole: Awaited<ReturnType<typeof activeTeamRole>> = null
    if (session.team_id) {
      targetRole = await activeTeamRole(ctx.env.DB, session.team_id, user.id)
      if (targetRole === null) throw new ApiError('NOT_FOUND')
      if (targetRole !== 'owner' && targetRole !== 'admin') throw new ApiError('FORBIDDEN')
    } else if (session.owner_user_id !== user.id) {
      throw new ApiError('NOT_FOUND')
    }
    if (session.withdrawn_at !== null) {
      throw new ApiError('GONE', 'withdrawn', { withdrawnAt: session.withdrawn_at })
    }

    const requestedTeamId = body.data.team_id ?? null
    if (session.team_id && requestedTeamId && requestedTeamId !== session.team_id) {
      throw new ApiError('CONFLICT', 'a Team-owned Session cannot move to another Team')
    }
    const targetTeamId = session.team_id ?? requestedTeamId
    if (body.data.visibility === 'team' && !targetTeamId) {
      throw new ApiError('UNPROCESSABLE', 'Team visibility requires team_id')
    }
    if (body.data.visibility === 'public' && !isDiscoverySessionSid(sid)) {
      throw new ApiError('UNPROCESSABLE', 'this provider cannot be published to Explore yet')
    }

    if (!session.team_id) {
      if (targetTeamId) {
        targetRole = await activeTeamRole(ctx.env.DB, targetTeamId, user.id)
        if (targetRole === null) throw new ApiError('NOT_FOUND')
      }
    }
    const requireTargetManager =
      targetTeamId !== null && (session.team_id !== null || body.data.visibility !== 'team')
    if (requireTargetManager && targetRole !== 'owner' && targetRole !== 'admin') {
      throw new ApiError('FORBIDDEN')
    }
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'hub-visibility-h',
      key: `${user.id}:${sid}`,
      windowSec: 60 * 60,
      max: 60,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const wasPublic = await isPublishedToDiscovery(ctx.env.DB, sid)

    // Personal -> Team is a durable ownership transfer. Alias every object
    // before the final D1 batch; if any preparation fails, public access stays
    // unchanged and partial aliases are unreachable/idempotent.
    let aliasOids: string[] = []
    if (!session.team_id && targetTeamId) {
      const manifest = await readManifest(ctx.env.HUB, session.root)
      if (!manifest || manifest.length < session.record_count) {
        throw new ApiError('INTERNAL', 'manifest missing')
      }
      const wanted = [
        ...new Set([
          ...manifest.slice(0, session.record_count),
          ...(session.view_oid ? [session.view_oid] : []),
          ...(session.spool_file_oid ? [session.spool_file_oid] : []),
        ]),
      ]
      // A previous attempt may have committed some aliases before a quota or
      // authorization failure. Only missing Team oids consume quota on retry.
      const teamPresent = await presentTeamOids(ctx.env.DB, targetTeamId, wanted)
      aliasOids = wanted.filter((oid) => !teamPresent.has(oid))
      const present = await presentOids(ctx.env.DB, user.id, aliasOids)
      const missing = aliasOids.filter((oid) => !present.has(oid))
      if (missing.length > 0) {
        throw new ApiError('CONFLICT', 'Session objects are incomplete', {
          missing: missing.slice(0, 20),
        })
      }
      if (aliasOids.length > 0) {
        const [used, incoming] = await Promise.all([
          teamStorageBytes(ctx.env.DB, targetTeamId),
          personalObjectBytes(ctx.env.DB, user.id, aliasOids),
        ])
        if (used + incoming > TEAM_QUOTA_BYTES) {
          throw new ApiError('UNPROCESSABLE', 'Team storage quota exceeded')
        }
      }
    }

    const now = Math.max(Date.now(), session.updated_at + 1)
    const safeLineageJson = await filterLineageForAudience(
      ctx.env.DB,
      session.lineage_json,
      body.data.visibility === 'team' ? targetTeamId : null,
    )
    const targetVisibility: 'private' | 'unlisted' =
      body.data.visibility === 'team' ? 'private' : 'unlisted'
    const statements = [
      prepareAuthorizedVisibilityUpdate(ctx.env.DB, {
        sid,
        actorUserId: user.id,
        expectedTeamId: session.team_id,
        expectedVisibility: session.visibility,
        expectedPublished: wasPublic,
        expectedRoot: session.root,
        expectedUpdatedAt: session.updated_at,
        targetTeamId,
        targetVisibility,
        lineageJson: safeLineageJson,
        requireTargetManager,
        now,
      }),
    ]
    if (targetTeamId && aliasOids.length > 0) {
      statements.push(
        ...prepareAuthorizedPersonalObjectAliases(ctx.env.DB, {
          sid,
          ownerUserId: session.owner_user_id,
          actorUserId: user.id,
          teamId: targetTeamId,
          root: session.root,
          updatedAt: now,
          visibility: targetVisibility,
          oids: aliasOids,
          now,
          requireTeamManager: requireTargetManager,
        }),
      )
    }
    const projectionGate = {
      sid,
      actorUserId: user.id,
      teamId: targetTeamId,
      root: session.root,
      updatedAt: now,
      visibility: targetVisibility,
      withdrawn: false,
      requireAuthor: false,
      requireTeamManager: requireTargetManager,
    }

    if (body.data.visibility === 'public') {
      if (!session.view_oid) throw new ApiError('UNPROCESSABLE', 'Session has no readable view')
      const view = await readDiscoveryView(
        ctx.env.DB,
        ctx.env.HUB,
        session.owner_user_id,
        session.view_oid,
        targetTeamId,
      )
      statements.push(
        prepareAuthorizedDiscoveryProjectionUpsert(
          ctx.env.DB,
          buildDiscoveryProjection({
            sid,
            summaryMd: session.note_md,
            lineageJson: safeLineageJson,
            recordCount: session.record_count,
            publishedAt: session.created_at,
            updatedAt: now,
            view,
            costOverride:
              session.total_tokens !== null && session.total_tokens > 0
                ? { usd: session.cost_usd, totalTokens: session.total_tokens }
                : null,
          }),
          projectionGate,
        ),
      )
    } else {
      statements.push(
        prepareAuthorizedEngagementDelete(ctx.env.DB, projectionGate),
        prepareAuthorizedDiscoveryProjectionDelete(ctx.env.DB, projectionGate),
      )
    }

    let results
    try {
      results = await ctx.env.DB.batch(statements)
    } catch (error) {
      if (isTeamStorageQuotaError(error)) {
        throw new ApiError('UNPROCESSABLE', 'Team storage quota exceeded')
      }
      throw error
    }
    if ((results[0]?.meta.changes ?? 0) === 0) throw new ApiError('NOT_FOUND')
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'hub-visibility',
      target_id: sid,
      details: { visibility: body.data.visibility, team_id: targetTeamId },
    })

    const changed = await getHubSession(ctx.env.DB, sid)
    if (!changed) throw new ApiError('INTERNAL', 'Session update failed')
    const [teamName, finalTeamRole] = changed.team_id
      ? await Promise.all([
          ctx.env.DB.prepare('SELECT name FROM teams WHERE id=?')
            .bind(changed.team_id)
            .first<{ name: string }>(),
          activeTeamRole(ctx.env.DB, changed.team_id, user.id),
        ])
      : [null, null]
    const canManageVisibility =
      changed.team_id === null || finalTeamRole === 'owner' || finalTeamRole === 'admin'
    return jsonOk({
      session: await serializeManagedSession(
        ctx.env.DB,
        {
          ...changed,
          team_name: teamName?.name ?? null,
        },
        canManageVisibility,
      ),
    })
  } catch (error) {
    return jsonError(error)
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid json')
  }
}
