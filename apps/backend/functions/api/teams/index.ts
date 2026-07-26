import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../src/audit-after-commit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import {
  assertHandleAvailable,
  changeTeamHandle,
  chooseAvailableTeamHandle,
} from '../../../src/handles'
import { checkRate } from '../../../src/rate-limit'
import {
  completeWorkosCleanup,
  opportunisticallyDrainWorkosCleanup,
} from '../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../src/teams/env'
import { MAX_ACTIVE_TEAMS_CREATED_PER_USER, TEAM_CREATE_RATE } from '../../../src/teams/limits'
import {
  adoptTeamCreationHandle,
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
    const { name, handle } = await parseCreateTeamBody(ctx.request)
    const withRequiredHandle = async (teamId: string, requestedHandle: string) => {
      const current = await getTeamForMember(ctx.env.DB, teamId, user.id)
      if (!current) throw new ApiError('INTERNAL', 'created team could not be loaded')
      if (current.handle !== null && current.handle !== requestedHandle) {
        throw new ApiError('CONFLICT', 'Team creation handle does not match its receipt')
      }
      if (current.handle === null) {
        await assertHandleAvailable(ctx.env.DB, requestedHandle)
        await changeTeamHandle(ctx.env.DB, {
          teamId,
          actorUserId: user.id,
          handle: requestedHandle,
          now: Date.now(),
        })
      }
      const reloaded = (await getTeamForMember(ctx.env.DB, teamId, user.id)) ?? current
      if (reloaded.handle !== requestedHandle) {
        throw new ApiError('INTERNAL', 'created Team is missing its requested handle')
      }
      return reloaded
    }
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
      const teamId = newTeamId()
      const requestedHandle =
        handle ??
        (await chooseAvailableTeamHandle(ctx.env.DB, {
          label: name,
          teamId,
        }))
      if (handle !== undefined) await assertHandleAvailable(ctx.env.DB, requestedHandle)
      const begun = await beginTeamCreationRequest(ctx.env.DB, {
        userId: user.id,
        idempotencyKey,
        teamId,
        name,
        requestedHandle,
        now: Date.now(),
      })
      creation = begun.request
      resuming = !begun.created
      if (creation.normalized_name !== name) {
        throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another Team')
      }
    }
    let existingTeam = resuming
      ? await getTeamForMember(ctx.env.DB, creation.team_id, user.id)
      : null
    if (creation.requested_handle === null) {
      const requestedHandle =
        existingTeam?.handle ??
        handle ??
        (await chooseAvailableTeamHandle(ctx.env.DB, {
          label: name,
          teamId: creation.team_id,
        }))
      if (existingTeam?.handle == null) {
        await assertHandleAvailable(ctx.env.DB, requestedHandle)
      }
      creation = await adoptTeamCreationHandle(
        ctx.env.DB,
        user.id,
        idempotencyKey,
        requestedHandle,
        Date.now(),
      )
    }
    const requestedHandle = creation.requested_handle
    if (requestedHandle === null) {
      throw new ApiError('INTERNAL', 'Team creation request is missing handle intent')
    }
    if (handle !== undefined && requestedHandle !== handle) {
      throw new ApiError('CONFLICT', 'Idempotency-Key was already used with another handle')
    }
    if (existingTeam) {
      existingTeam = await withRequiredHandle(existingTeam.id, requestedHandle)
      if (creation.status !== 'completed') {
        await completeTeamCreationRequest(
          ctx.env.DB,
          user.id,
          idempotencyKey,
          creation.team_id,
          requestedHandle,
          Date.now(),
        )
      }
      return jsonOk({ team: existingTeam })
    }

    const client = createWorkosTeamClient(ctx.env)
    const teamId = creation.team_id
    let organizationId = creation.workos_organization_id

    const recoverConcurrentSuccess = async () => {
      const row = await getTeamById(ctx.env.DB, teamId)
      if (!row || (organizationId !== null && row.workos_organization_id !== organizationId)) {
        return null
      }
      const memberTeam = await getTeamForMember(ctx.env.DB, teamId, user.id)
      if (!memberTeam) return null
      const team = await withRequiredHandle(teamId, requestedHandle)
      await completeTeamCreationRequest(
        ctx.env.DB,
        user.id,
        idempotencyKey,
        teamId,
        requestedHandle,
        Date.now(),
      )
      return team
    }
    const abandonTerminalAttempt = async (detail: string) => {
      const recoveredBeforeFailure = await recoverConcurrentSuccess()
      if (recoveredBeforeFailure) return recoveredBeforeFailure
      const failed = await failTeamCreationRequest(ctx.env.DB, user.id, idempotencyKey, Date.now())
      if (!failed) {
        const recoveredAfterFailure = await recoverConcurrentSuccess()
        if (recoveredAfterFailure) return recoveredAfterFailure
        throw new ApiError('CONFLICT', 'Team creation state changed; retry the same request')
      }
      if (organizationId !== null) {
        const organizationToDelete = organizationId
        await client
          .deleteOrganization(organizationToDelete)
          .then(() =>
            completeWorkosCleanup(ctx.env.DB, 'organization.delete', organizationToDelete),
          )
          .catch((compensationError: unknown) => {
            console.error('failed to compensate WorkOS organization creation', compensationError)
          })
      }
      throw new ApiError('CONFLICT', detail)
    }
    try {
      // This saves an upstream round trip in the common conflict case. The
      // atomic handles INSERT below remains the actual race boundary.
      await assertHandleAvailable(ctx.env.DB, requestedHandle)
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'CONFLICT') throw error
      const recovered = await abandonTerminalAttempt('handle taken')
      return jsonOk({ team: recovered })
    }

    const workosUserId = await getWorkosUserId(ctx.env.DB, user.id)
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
        requestedHandle,
        now: Date.now(),
      })
    } catch (error) {
      const recovered = await recoverConcurrentSuccess()
      if (recovered) return jsonOk({ team: recovered })
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: handles(?:\.handle|\.team_id)?/i.test(error.message)
      ) {
        const terminalRecovery = await abandonTerminalAttempt('handle taken')
        return jsonOk({ team: terminalRecovery })
      }
      throw error
    }
    if (!created) {
      const recovered = await recoverConcurrentSuccess()
      if (recovered) return jsonOk({ team: recovered })
      const terminalRecovery = await abandonTerminalAttempt('active team limit reached')
      return jsonOk({ team: terminalRecovery })
    }

    const teamWithHandle = await withRequiredHandle(teamId, requestedHandle)
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.create',
      target_id: teamId,
    })
    return jsonOk({ team: teamWithHandle }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
