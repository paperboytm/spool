import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../src/audit-after-commit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'
import {
  completeWorkosCleanup,
  opportunisticallyDrainWorkosCleanup,
} from '../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../src/teams/env'
import { MAX_ACTIVE_TEAMS_CREATED_PER_USER, TEAM_CREATE_RATE } from '../../../src/teams/limits'
import {
  beginTeamCreationRequest,
  completeTeamCreationRequest,
  countActiveTeamsCreatedByUser,
  createLocalTeam,
  failTeamCreationRequest,
  getTeamById,
  getTeamForMember,
  getTeamCreationRequest,
  getWorkosUserId,
  listTeamsForUser,
  newTeamId,
  recordTeamCreationOrganization,
} from '../../../src/teams/store'
import { parseCreateTeamBody, requireIdempotencyKey } from '../../../src/teams/validators'
import { createWorkosTeamClient } from '../../../src/teams/workos-client'

export const onRequestGet: PagesFunction<TeamApiEnv> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    ctx.waitUntil(opportunisticallyDrainWorkosCleanup(ctx.env.DB, ctx.env))
    return jsonOk({ teams: await listTeamsForUser(ctx.env.DB, user.id) })
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestPost: PagesFunction<TeamApiEnv> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    if (user.deletion_pending_until != null) {
      throw new ApiError('CONFLICT', 'cancel account deletion before creating a Team')
    }
    const { name } = await parseCreateTeamBody(ctx.request)
    const idempotencyKey = requireIdempotencyKey(ctx.request)
    let creation = await getTeamCreationRequest(ctx.env.DB, user.id, idempotencyKey)
    let resuming = creation !== null
    if (creation && creation.normalized_name !== name) {
      throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another Team')
    }
    if (creation?.status === 'failed') {
      throw new ApiError('CONFLICT', 'this Team creation attempt cannot be retried')
    }
    if (!creation) {
      const rate = await checkRate(ctx.env.RATE, { ...TEAM_CREATE_RATE, key: user.id })
      if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
      if (
        (await countActiveTeamsCreatedByUser(ctx.env.DB, user.id)) >=
        MAX_ACTIVE_TEAMS_CREATED_PER_USER
      ) {
        throw new ApiError('CONFLICT', 'active team limit reached')
      }
      const begun = await beginTeamCreationRequest(ctx.env.DB, {
        userId: user.id,
        idempotencyKey,
        teamId: newTeamId(),
        name,
        now: Date.now(),
      })
      creation = begun.request
      resuming = !begun.created
      if (creation.normalized_name !== name) {
        throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another Team')
      }
    }
    const existingTeam = resuming
      ? await getTeamForMember(ctx.env.DB, creation.team_id, user.id)
      : null
    if (existingTeam) {
      if (creation.status !== 'completed') {
        await completeTeamCreationRequest(
          ctx.env.DB,
          user.id,
          idempotencyKey,
          creation.team_id,
          Date.now(),
        )
      }
      return jsonOk({ team: existingTeam })
    }

    const workosUserId = await getWorkosUserId(ctx.env.DB, user.id)
    const client = createWorkosTeamClient(ctx.env)
    const teamId = creation.team_id
    let organizationId = creation.workos_organization_id
    if (!organizationId) {
      let organization
      try {
        organization = await client.getOrganizationByExternalId(teamId)
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error
        try {
          organization = await client.createOrganization(name, teamId)
        } catch (createError) {
          if (!(createError instanceof ApiError) || createError.code !== 'CONFLICT') {
            throw createError
          }
          organization = await client.getOrganizationByExternalId(teamId)
        }
      }
      organizationId = organization.id
      await recordTeamCreationOrganization(
        ctx.env.DB,
        user.id,
        idempotencyKey,
        organizationId,
        Date.now(),
      )
    }

    // Both WorkOS mutations use stable idempotency keys. A timeout leaves the
    // request pending; replaying the same browser key resumes by the unique
    // WorkOS external_id instead of creating a second Organization.
    const recoverConcurrentSuccess = async () => {
      const row = await getTeamById(ctx.env.DB, teamId)
      if (!row || row.workos_organization_id !== organizationId) return null
      const team = await getTeamForMember(ctx.env.DB, teamId, user.id)
      if (!team) return null
      await completeTeamCreationRequest(ctx.env.DB, user.id, idempotencyKey, teamId, Date.now())
      return team
    }

    let membership
    try {
      membership = await client.createMembership(organizationId, workosUserId)
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'CONFLICT') throw error
      membership = (await client.listActiveMemberships(workosUserId)).find(
        (candidate) => candidate.organization_id === organizationId,
      )
      if (!membership) throw error
    }
    let created: boolean
    try {
      created = await createLocalTeam(ctx.env.DB, {
        id: teamId,
        name,
        workosOrganizationId: organizationId,
        workosMembershipId: membership.id,
        workosMembershipUpdatedAt: membership.updated_at ? Date.parse(membership.updated_at) : null,
        idempotencyKey,
        ownerUserId: user.id,
        now: Date.now(),
      })
    } catch (error) {
      const recovered = await recoverConcurrentSuccess()
      if (recovered) return jsonOk({ team: recovered })
      throw error
    }
    if (!created) {
      const recovered = await recoverConcurrentSuccess()
      if (recovered) return jsonOk({ team: recovered })
      const failed = await failTeamCreationRequest(ctx.env.DB, user.id, idempotencyKey, Date.now())
      if (!failed) {
        const recovered = await recoverConcurrentSuccess()
        if (recovered) return jsonOk({ team: recovered })
        throw new ApiError('CONFLICT', 'Team creation state changed; retry the same request')
      }
      await client
        .deleteOrganization(organizationId)
        .then(() => completeWorkosCleanup(ctx.env.DB, 'organization.delete', organizationId))
        .catch((compensationError: unknown) => {
          console.error('failed to compensate WorkOS organization creation', compensationError)
        })
      throw new ApiError('CONFLICT', 'active team limit reached')
    }

    const team = await getTeamForMember(ctx.env.DB, teamId, user.id)
    if (!team) throw new ApiError('INTERNAL', 'created team could not be loaded')
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.create',
      target_id: teamId,
    })
    return jsonOk({ team }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
