import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../../src/audit-after-commit'
import { requireUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { checkRate } from '../../../../../src/rate-limit'
import { requireTeamAccess } from '../../../../../src/teams/auth'
import { opportunisticallyDrainWorkosCleanup } from '../../../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../../../src/teams/env'
import {
  MAX_PENDING_INVITATIONS_PER_TEAM,
  TEAM_INVITATION_RATE,
} from '../../../../../src/teams/limits'
import {
  beginTeamInvitationCreationRequest,
  completeTeamInvitationCreationRequest,
  countPendingTeamInvitations,
  createLocalInvitation,
  failTeamInvitationCreationRequest,
  getTeamInvitation,
  getTeamInvitationCreationRequest,
  getTeamInvitationResponse,
  getWorkosUserId,
  hasTeamMemberWithEmail,
  listTeamInvitations,
  newTeamInvitationId,
  recordTeamInvitationCreationWorkosId,
  reconcileInvitationProjections,
} from '../../../../../src/teams/store'
import {
  normalizeEmail,
  parseInviteBody,
  requireIdempotencyKey,
  requireTeamId,
} from '../../../../../src/teams/validators'
import {
  createWorkosTeamClient,
  type WorkosInvitation,
} from '../../../../../src/teams/workos-client'

type Params = 'teamId'

export const onRequestGet: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const { team } = await requireTeamAccess(ctx.env.DB, teamId, user.id, 'members:invite')
    const upstream = await createWorkosTeamClient(ctx.env).listAllInvitations(
      team.workos_organization_id,
    )
    await reconcileInvitationProjections(ctx.env.DB, teamId, upstream)
    return jsonOk({ invitations: await listTeamInvitations(ctx.env.DB, teamId) })
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestPost: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const body = await parseInviteBody(ctx.request)
    const email = normalizeEmail(body.email)
    const idempotencyKey = requireIdempotencyKey(ctx.request)
    if (email === user.email.trim().toLowerCase()) {
      throw new ApiError('CONFLICT', 'you are already a team member')
    }
    const { team } = await requireTeamAccess(ctx.env.DB, teamId, user.id, 'members:invite')
    let creation = await getTeamInvitationCreationRequest(
      ctx.env.DB,
      teamId,
      user.id,
      idempotencyKey,
    )
    let resuming = creation !== null
    let projectionChecked = false
    if (creation && (creation.normalized_email !== email || creation.desired_role !== body.role)) {
      throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another invitation')
    }
    if (creation?.status === 'failed') {
      throw new ApiError('CONFLICT', 'this invitation attempt cannot be retried')
    }

    // Preserve stable replay semantics even after the invitee has joined.
    // A completed local projection is the only resource identity we trust.
    if (creation) {
      projectionChecked = true
      const replay = await getTeamInvitationResponse(ctx.env.DB, teamId, creation.invitation_id)
      if (replay) {
        const existingRow = await getTeamInvitation(ctx.env.DB, teamId, creation.invitation_id)
        if (existingRow && creation.status !== 'completed') {
          await completeTeamInvitationCreationRequest(ctx.env.DB, {
            teamId,
            invitedByUserId: user.id,
            idempotencyKey,
            invitationId: creation.invitation_id,
            workosInvitationId: existingRow.workos_invitation_id,
            now: Date.now(),
          })
        }
        return jsonOk({ invitation: replay })
      }
    }

    const client = createWorkosTeamClient(ctx.env)
    if (!creation) {
      if (await hasTeamMemberWithEmail(ctx.env.DB, teamId, email)) {
        throw new ApiError('CONFLICT', 'this person is already a team member')
      }
      const rate = await checkRate(ctx.env.RATE, {
        ...TEAM_INVITATION_RATE,
        key: teamId,
      })
      if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
      if (
        (await countPendingTeamInvitations(ctx.env.DB, teamId)) >= MAX_PENDING_INVITATIONS_PER_TEAM
      ) {
        const upstream = await client.listAllInvitations(team.workos_organization_id)
        await reconcileInvitationProjections(ctx.env.DB, teamId, upstream)
        if (
          (await countPendingTeamInvitations(ctx.env.DB, teamId)) >=
          MAX_PENDING_INVITATIONS_PER_TEAM
        ) {
          throw new ApiError('CONFLICT', 'pending invitation limit reached')
        }
      }
      const begun = await beginTeamInvitationCreationRequest(ctx.env.DB, {
        teamId,
        invitedByUserId: user.id,
        idempotencyKey,
        invitationId: newTeamInvitationId(),
        email,
        desiredRole: body.role,
        now: Date.now(),
      })
      creation = begun.request
      resuming = !begun.created
      if (creation.normalized_email !== email || creation.desired_role !== body.role) {
        throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another invitation')
      }
    }

    const invitationId = creation.invitation_id
    if (!projectionChecked) {
      const replay = await getTeamInvitationResponse(ctx.env.DB, teamId, invitationId)
      if (replay) {
        const existingRow = await getTeamInvitation(ctx.env.DB, teamId, invitationId)
        if (existingRow && creation.status !== 'completed') {
          await completeTeamInvitationCreationRequest(ctx.env.DB, {
            teamId,
            invitedByUserId: user.id,
            idempotencyKey,
            invitationId,
            workosInvitationId: existingRow.workos_invitation_id,
            now: Date.now(),
          })
        }
        return jsonOk({ invitation: replay })
      }
    }

    const inviterUserId = await getWorkosUserId(ctx.env.DB, user.id)
    let upstream: WorkosInvitation
    if (creation.workos_invitation_id) {
      upstream = await client.getInvitation(creation.workos_invitation_id)
    } else {
      try {
        upstream = await client.createInvitation({
          email,
          organizationId: team.workos_organization_id,
          inviterUserId,
          idempotencyKey: `spool-team-invitation-${invitationId}`,
        })
      } catch (error) {
        // A same-email WorkOS conflict cannot identify this request's
        // resource. Adopting an arbitrary historic invitation would allow
        // later compensation to delete a legitimate active membership.
        throw error
      }
      await recordTeamInvitationCreationWorkosId(ctx.env.DB, {
        teamId,
        invitedByUserId: user.id,
        idempotencyKey,
        workosInvitationId: upstream.id,
        now: Date.now(),
      })
      const recorded = await getTeamInvitationCreationRequest(
        ctx.env.DB,
        teamId,
        user.id,
        idempotencyKey,
      )
      if (!recorded?.workos_invitation_id) {
        throw new ApiError('INTERNAL', 'invitation creation request could not be updated')
      }
      creation = recorded
      if (resuming || recorded.workos_invitation_id !== upstream.id) {
        upstream = await client.getInvitation(recorded.workos_invitation_id)
      }
    }

    const recoverConcurrentSuccess = async () => {
      const row = await getTeamInvitation(ctx.env.DB, teamId, invitationId)
      if (!row) return null
      await completeTeamInvitationCreationRequest(ctx.env.DB, {
        teamId,
        invitedByUserId: user.id,
        idempotencyKey,
        invitationId,
        workosInvitationId: row.workos_invitation_id,
        now: Date.now(),
      })
      return getTeamInvitationResponse(ctx.env.DB, teamId, invitationId)
    }

    let inserted: boolean
    try {
      inserted = await createLocalInvitation(ctx.env.DB, {
        id: invitationId,
        teamId,
        email,
        desiredRole: body.role,
        invitedByUserId: user.id,
        idempotencyKey,
        invitation: upstream,
        now: Date.now(),
      })
    } catch (error) {
      const recovered = await recoverConcurrentSuccess()
      if (recovered) return jsonOk({ invitation: recovered })
      // Leave the durable request pending on a transient D1 failure. A retry
      // with the same browser key reuses both ids and cannot orphan a second
      // WorkOS invitation.
      throw error
    }
    if (!inserted) {
      const recovered = await recoverConcurrentSuccess()
      if (recovered) return jsonOk({ invitation: recovered })
      // The SQL final gate may have observed a member who joined after the
      // preflight. Do not enqueue accepted-invite compensation in this
      // ambiguous state because it could remove that legitimate membership.
      if (await hasTeamMemberWithEmail(ctx.env.DB, teamId, email)) {
        throw new ApiError('CONFLICT', 'this person is already a team member')
      }
      const failed = await failTeamInvitationCreationRequest(ctx.env.DB, {
        teamId,
        invitedByUserId: user.id,
        idempotencyKey,
        now: Date.now(),
      })
      if (!failed) {
        const concurrent = await recoverConcurrentSuccess()
        if (concurrent) return jsonOk({ invitation: concurrent })
        throw new ApiError('CONFLICT', 'invitation state changed; retry the same request')
      }
      await opportunisticallyDrainWorkosCleanup(ctx.env.DB, ctx.env)
      throw new ApiError('CONFLICT', 'pending invitation limit reached')
    }

    const invitation = await getTeamInvitationResponse(ctx.env.DB, teamId, invitationId)
    if (!invitation) throw new ApiError('INTERNAL', 'created invitation could not be loaded')
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.invitation.create',
      target_id: teamId,
      details: { email, role: body.role },
    })
    return jsonOk({ invitation }, { status: resuming ? 200 : 201 })
  } catch (error) {
    return jsonError(error)
  }
}
