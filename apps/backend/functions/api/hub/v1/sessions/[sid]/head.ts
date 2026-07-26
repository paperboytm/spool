import type { D1PreparedStatement, PagesFunction } from '@cloudflare/workers-types'
import { costForUsage, isDiscoverySessionSid } from '@spool-lab/session-kit'

import { auditAfterCommit } from '../../../../../../src/audit-after-commit'
import {
  buildDiscoveryProjection,
  filterLineageForAudience,
  isPublishedToDiscovery,
  prepareAuthorizedDiscoveryProjectionDelete,
  prepareAuthorizedDiscoveryProjectionUpsert,
  prepareAuthorizedEngagementDelete,
  prepareAuthorizedProjectOutsiderWatchesDeleteWhenNotPublic,
  prepareAuthorizedProjectStarsDeleteWhenNotPublic,
  prepareAuthorizedTargetStarsDelete,
  readDiscoveryView,
} from '../../../../../../src/discovery/projection'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireHubUser } from '../../../../../../src/hub/auth'
import {
  prepareSessionGuidanceProjection,
  validateSessionGuidanceForHead,
} from '../../../../../../src/hub/guidance'
import { validateHead, type HubEnv } from '../../../../../../src/hub/head'
import { writeManifest } from '../../../../../../src/hub/packs'
import {
  prepareVerifiedForkClaim,
  sanitizeResumeLineageProof,
} from '../../../../../../src/hub/resume-grants'
import {
  getHubSession,
  isTeamStorageQuotaError,
  personalObjectBytes,
  prepareAuthorizedPersonalObjectAliases,
  prepareAuthorizedHeadInsert,
  prepareAuthorizedHeadUpdate,
  teamStorageBytes,
} from '../../../../../../src/hub/store'
import { parseHeadBody, requireSid, TEAM_QUOTA_BYTES } from '../../../../../../src/hub/wire'
import {
  ensureProjectTenantHandle,
  prepareAuthorizedDefaultProjectInsert,
} from '../../../../../../src/projects/store'
import { publicBaseUrl } from '../../../../../../src/public-url'

// Step 3 of the share handshake: commit the head. Re-runs the same
// validation as push (the two calls race against nothing — heads are
// single-writer), requires every object to be present, then atomically
// advances the ref. The manifest object is what the read path uses to
// resolve record positions → oids.

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params['sid'])
    const body = await parseHeadBody(ctx.request)

    const existing = await getHubSession(ctx.env.DB, sid)
    const { missing, aliasOids, teamId, teamRole, projectId, projectNeedsInsert } =
      await validateHead(ctx.env.DB, user.id, sid, body)
    if (missing.length > 0) {
      throw new ApiError('CONFLICT', 'objects missing — upload before committing', {
        missing: missing.slice(0, 50),
      })
    }
    if (existing?.team_id && existing.withdrawn_at !== null) {
      // Team withdrawal is permanent. A Team author may continue an active
      // Session, but no role can resurrect a tenant tombstone through head.
      throw new ApiError('GONE', 'withdrawn', { withdrawnAt: existing.withdrawn_at })
    }

    const discoverySupported = isDiscoverySessionSid(sid)
    const wasPublic = existing ? await isPublishedToDiscovery(ctx.env.DB, sid) : false
    const effectiveVisibility =
      body.visibility ??
      (existing
        ? existing.visibility === 'private' && existing.team_id
          ? 'team'
          : wasPublic
            ? 'public'
            : 'link-only'
        : teamId
          ? 'team'
          : discoverySupported
            ? 'public'
            : 'link-only')
    if (effectiveVisibility === 'team' && !teamId) {
      throw new ApiError('UNPROCESSABLE', 'Team visibility requires a Team')
    }
    if (effectiveVisibility === 'public' && !discoverySupported) {
      throw new ApiError('UNPROCESSABLE', 'this provider can only be Link-only or Team-visible')
    }
    const currentVisibility = existing
      ? existing.visibility === 'private' && existing.team_id
        ? 'team'
        : wasPublic
          ? 'public'
          : 'link-only'
      : null
    const accessChanged =
      existing === null || existing.team_id !== teamId || currentVisibility !== effectiveVisibility
    const projectChanged = existing === null || existing.project_id !== projectId
    const requestedStorageVisibility: 'private' | 'unlisted' =
      effectiveVisibility === 'team' ? 'private' : 'unlisted'
    const committedStorageVisibility: 'private' | 'unlisted' =
      existing && !accessChanged
        ? (existing.visibility as 'private' | 'unlisted')
        : requestedStorageVisibility
    const existingTeamOwned = existing?.team_id != null
    const requireTeamManager =
      teamId !== null &&
      ((existingTeamOwned && accessChanged) ||
        (existingTeamOwned && projectChanged) ||
        (!existingTeamOwned && effectiveVisibility !== 'team'))
    if (requireTeamManager && teamRole !== 'owner' && teamRole !== 'admin') {
      throw new ApiError('FORBIDDEN')
    }
    const resumeLineage = sanitizeResumeLineageProof(body.lineageJson)
    const safeLineageJson = await filterLineageForAudience(
      ctx.env.DB,
      resumeLineage.lineageJson,
      effectiveVisibility === 'team' ? teamId : null,
    )

    // Validate the declared view before advancing the head. During a transfer,
    // objects not yet in the Team index still live in the current writer's
    // personal namespace; after validation they are aliased before access flips.
    const view = await readDiscoveryView(
      ctx.env.DB,
      ctx.env.HUB,
      user.id,
      body.viewOid,
      teamId && !aliasOids.includes(body.viewOid) ? teamId : null,
    )
    const guidance = validateSessionGuidanceForHead(view.guidance, body.count)
    const sameRecordRoot = existing?.root === body.root
    // Pricing is part of the publication event, not the read path. Persist
    // this one calculation on the Hub row and reuse it for the projection.
    const cost =
      sameRecordRoot && existing?.total_tokens !== null && existing?.total_tokens !== undefined
        ? { usd: existing.cost_usd, totalTokens: existing.total_tokens }
        : costForUsage(view.usage)

    if (teamId && aliasOids.length > 0) {
      const [used, incoming] = await Promise.all([
        teamStorageBytes(ctx.env.DB, teamId),
        personalObjectBytes(ctx.env.DB, user.id, aliasOids),
      ])
      if (used + incoming > TEAM_QUOTA_BYTES) {
        throw new ApiError('UNPROCESSABLE', 'Team storage quota exceeded')
      }
    }

    const now = existing ? Math.max(Date.now(), existing.updated_at + 1) : Date.now()
    const sessionWrite = {
      sid,
      ownerUserId: user.id,
      root: body.root,
      recordCount: body.count,
      sig: body.sig,
      cardJson: body.cardJson,
      summaryMd: body.summaryMd,
      lineageJson: safeLineageJson,
      viewOid: body.viewOid,
      spoolFileOid: body.spoolFileOid,
      costUsd: cost?.usd ?? null,
      totalTokens: cost?.totalTokens ?? null,
      projectId,
      now,
      actorUserId: user.id,
      expectedTeamId: existing?.team_id ?? null,
      expectedProjectId: existing?.project_id ?? null,
      expectedVisibility: existing?.visibility ?? 'unlisted',
      expectedWithdrawnAt: existing?.withdrawn_at ?? null,
      expectedRoot: existing?.root ?? null,
      expectedUpdatedAt: existing?.updated_at ?? null,
      expectedPublished: wasPublic,
      targetTeamId: teamId,
      targetProjectId: projectId,
      targetVisibility: requestedStorageVisibility,
      changeAccess: accessChanged,
      changeProject: projectChanged,
      clearWithdrawal: existing?.team_id == null && existing?.withdrawn_at != null,
      requireTeamManager,
    } as const
    const sessionCommit =
      existing === null
        ? prepareAuthorizedHeadInsert(ctx.env.DB, sessionWrite)
        : prepareAuthorizedHeadUpdate(ctx.env.DB, sessionWrite)
    const statements: D1PreparedStatement[] = []
    // A Project may have been synthesized by the rolling-deploy compatibility
    // trigger while the previous Worker was still serving traffic. Repair the
    // tenant route identity before every commit, not only on first creation.
    await ensureProjectTenantHandle(ctx.env.DB, {
      actorUserId: user.id,
      tenant: teamId === null ? { userId: user.id, teamId: null } : { userId: null, teamId },
      now,
    })
    if (projectNeedsInsert) {
      statements.push(
        prepareAuthorizedDefaultProjectInsert(ctx.env.DB, {
          actorUserId: user.id,
          tenant: teamId === null ? { userId: user.id, teamId: null } : { userId: null, teamId },
          now,
        }),
      )
    }
    const sessionCommitIndex = statements.length
    statements.push(sessionCommit)
    // A legacy client may recommit Summary/card metadata against the same
    // immutable record root. Preserve a server-backfilled projection when
    // that old view cannot carry guidance; a new root without guidance must
    // still clear the stale row.
    if (guidance !== undefined || !sameRecordRoot) {
      statements.push(
        prepareSessionGuidanceProjection(ctx.env.DB, {
          sid,
          ownerUserId: user.id,
          root: body.root,
          viewOid: body.viewOid,
          updatedAt: now,
          guidance,
        }),
      )
    }
    if (teamId && aliasOids.length > 0) {
      statements.push(
        ...prepareAuthorizedPersonalObjectAliases(ctx.env.DB, {
          sid,
          ownerUserId: user.id,
          actorUserId: user.id,
          teamId,
          root: body.root,
          updatedAt: now,
          visibility: committedStorageVisibility,
          oids: aliasOids,
          now,
          requireTeamManager,
        }),
      )
    }
    // A verified fork is established only on the child's first head commit.
    // The proof itself is never persisted; invalid, expired, or reused grants
    // degrade to legacy display lineage without blocking the share.
    if (existing === null && safeLineageJson !== null && resumeLineage.claim !== null) {
      statements.push(
        ...(await prepareVerifiedForkClaim(ctx.env.DB, {
          claim: resumeLineage.claim,
          childSid: sid,
          childRoot: body.root,
          childOwnerUserId: user.id,
          childCreatedAt: now,
          audienceTeamId: effectiveVisibility === 'team' ? teamId : null,
          now,
        })),
      )
    }
    const projectionGate = {
      sid,
      actorUserId: user.id,
      teamId,
      root: body.root,
      updatedAt: now,
      visibility: committedStorageVisibility,
      withdrawn: false,
      requireAuthor: true,
      requireTeamManager,
    }
    if (effectiveVisibility === 'public') {
      statements.push(
        prepareAuthorizedDiscoveryProjectionUpsert(
          ctx.env.DB,
          buildDiscoveryProjection({
            sid,
            summaryMd: body.summaryMd,
            lineageJson: safeLineageJson,
            recordCount: body.count,
            publishedAt: existing?.created_at ?? now,
            updatedAt: now,
            view,
            costOverride: cost,
          }),
          projectionGate,
        ),
      )
    } else if (teamId || body.visibility !== undefined || wasPublic) {
      // Visibility and public projections change in one D1 transaction. A
      // Team recommit also scrubs stale projections left by an older build.
      statements.push(
        prepareAuthorizedEngagementDelete(ctx.env.DB, projectionGate),
        prepareAuthorizedTargetStarsDelete(ctx.env.DB, projectionGate),
        prepareAuthorizedDiscoveryProjectionDelete(ctx.env.DB, projectionGate),
      )
    }
    if (existing && (wasPublic || projectChanged)) {
      // A visibility change or Project move can remove the old Project's final
      // Public Session. Run after the projection mutation so Public→Link-only
      // is observed correctly; keep current-member private Team Watches.
      statements.push(
        prepareAuthorizedProjectStarsDeleteWhenNotPublic(
          ctx.env.DB,
          existing.project_id,
          projectionGate,
        ),
        prepareAuthorizedProjectOutsiderWatchesDeleteWhenNotPublic(
          ctx.env.DB,
          existing.project_id,
          projectionGate,
        ),
      )
    }

    await writeManifest(ctx.env.HUB, body.root, body.manifest)
    let results
    try {
      results = await ctx.env.DB.batch(statements)
    } catch (error) {
      if (isTeamStorageQuotaError(error)) {
        throw new ApiError('UNPROCESSABLE', 'Team storage quota exceeded')
      }
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed: hub_sessions.sid')
      ) {
        throw new ApiError('CONFLICT', 'Session was committed concurrently; retry')
      }
      throw error
    }
    if ((results[sessionCommitIndex]?.meta.changes ?? 0) === 0) {
      throw new ApiError('NOT_FOUND')
    }

    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'hub-share',
      target_id: sid,
      details: {
        root: body.root,
        count: body.count,
        visibility: effectiveVisibility,
        team_id: teamId,
        project_id: projectId,
      },
    })

    return jsonOk({ url: `${publicBaseUrl(ctx.env)}/session/${sid}` })
  } catch (e) {
    return jsonError(e)
  }
}
