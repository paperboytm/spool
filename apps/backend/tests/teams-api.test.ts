import type { D1Database } from '@cloudflare/workers-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  assertCanManageMember: vi.fn(),
  assertHandleAvailable: vi.fn(),
  chooseAvailableTeamHandle: vi.fn(),
  changeTeamHandle: vi.fn(),
  requireUser: vi.fn(),
  requireTeamAccess: vi.fn(),
  countActiveTeamsCreatedByUser: vi.fn(),
  countPendingTeamInvitations: vi.fn(),
  createLocalInvitation: vi.fn(),
  createLocalTeam: vi.fn(),
  beginTeamInvitationCreationRequest: vi.fn(),
  completeTeamInvitationCreationRequest: vi.fn(),
  failTeamInvitationCreationRequest: vi.fn(),
  getTeamForMember: vi.fn(),
  getTeamInvitation: vi.fn(),
  getTeamInvitationCreationRequest: vi.fn(),
  getTeamInvitationResponse: vi.fn(),
  getTeamMembership: vi.fn(),
  getUserById: vi.fn(),
  getWorkosUserId: vi.fn(),
  hasTeamMemberWithEmail: vi.fn(),
  insertInvitationProjection: vi.fn(),
  listTeamInvitations: vi.fn(),
  listTeamMembers: vi.fn(),
  listTeamsForUser: vi.fn(),
  newTeamId: vi.fn(),
  newTeamInvitationId: vi.fn(),
  recordTeamInvitationCreationWorkosId: vi.fn(),
  reconcileInvitationProjections: vi.fn(),
  removeLocalMembership: vi.fn(),
  countTeamOwners: vi.fn(),
  transferTeamOwnership: vi.fn(),
  updateMemberRole: vi.fn(),
  updateLocalTeamName: vi.fn(),
  updateInvitationProjection: vi.fn(),
  archiveLocalTeam: vi.fn(),
  adoptTeamCreationHandle: vi.fn(),
  beginTeamCreationRequest: vi.fn(),
  completeTeamCreationRequest: vi.fn(),
  failTeamCreationRequest: vi.fn(),
  getTeamCreationRequest: vi.fn(),
  getTeamById: vi.fn(),
  recordTeamCreationOrganization: vi.fn(),
  completeWorkosCleanup: vi.fn(),
  drainWorkosCleanupOutbox: vi.fn(),
  enqueueWorkosCleanup: vi.fn(),
  opportunisticallyDrainWorkosCleanup: vi.fn(),
  client: {
    createOrganization: vi.fn(),
    getOrganizationByExternalId: vi.fn(),
    createMembership: vi.fn(),
    listActiveMemberships: vi.fn(),
    deleteMembership: vi.fn(),
    deleteOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    createInvitation: vi.fn(),
    getInvitation: vi.fn(),
    listInvitations: vi.fn(),
    listAllInvitations: vi.fn(),
    revokeInvitation: vi.fn(),
    resendInvitation: vi.fn(),
  },
}))

vi.mock('../src/audit', () => ({ audit: mocks.audit }))
vi.mock('../src/auth/require', () => ({ requireUser: mocks.requireUser }))
vi.mock('../src/handles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/handles')>()),
  assertHandleAvailable: mocks.assertHandleAvailable,
  chooseAvailableTeamHandle: mocks.chooseAvailableTeamHandle,
  changeTeamHandle: mocks.changeTeamHandle,
}))
vi.mock('../src/store/d1', () => ({ getUserById: mocks.getUserById }))
vi.mock('../src/teams/auth', () => ({
  assertCanManageMember: mocks.assertCanManageMember,
  requireTeamAccess: mocks.requireTeamAccess,
}))
vi.mock('../src/teams/store', () => ({
  adoptTeamCreationHandle: mocks.adoptTeamCreationHandle,
  beginTeamInvitationCreationRequest: mocks.beginTeamInvitationCreationRequest,
  beginTeamCreationRequest: mocks.beginTeamCreationRequest,
  completeTeamInvitationCreationRequest: mocks.completeTeamInvitationCreationRequest,
  completeTeamCreationRequest: mocks.completeTeamCreationRequest,
  countTeamOwners: mocks.countTeamOwners,
  countActiveTeamsCreatedByUser: mocks.countActiveTeamsCreatedByUser,
  countPendingTeamInvitations: mocks.countPendingTeamInvitations,
  createLocalInvitation: mocks.createLocalInvitation,
  createLocalTeam: mocks.createLocalTeam,
  failTeamInvitationCreationRequest: mocks.failTeamInvitationCreationRequest,
  failTeamCreationRequest: mocks.failTeamCreationRequest,
  getTeamForMember: mocks.getTeamForMember,
  getTeamCreationRequest: mocks.getTeamCreationRequest,
  getTeamById: mocks.getTeamById,
  getTeamInvitation: mocks.getTeamInvitation,
  getTeamInvitationCreationRequest: mocks.getTeamInvitationCreationRequest,
  getTeamInvitationResponse: mocks.getTeamInvitationResponse,
  getTeamMembership: mocks.getTeamMembership,
  getWorkosUserId: mocks.getWorkosUserId,
  hasTeamMemberWithEmail: mocks.hasTeamMemberWithEmail,
  insertInvitationProjection: mocks.insertInvitationProjection,
  listTeamInvitations: mocks.listTeamInvitations,
  listTeamMembers: mocks.listTeamMembers,
  listTeamsForUser: mocks.listTeamsForUser,
  newTeamId: mocks.newTeamId,
  newTeamInvitationId: mocks.newTeamInvitationId,
  recordTeamInvitationCreationWorkosId: mocks.recordTeamInvitationCreationWorkosId,
  recordTeamCreationOrganization: mocks.recordTeamCreationOrganization,
  reconcileInvitationProjections: mocks.reconcileInvitationProjections,
  removeLocalMembership: mocks.removeLocalMembership,
  transferTeamOwnership: mocks.transferTeamOwnership,
  updateMemberRole: mocks.updateMemberRole,
  updateLocalTeamName: mocks.updateLocalTeamName,
  updateInvitationProjection: mocks.updateInvitationProjection,
  archiveLocalTeam: mocks.archiveLocalTeam,
}))
vi.mock('../src/teams/workos-client', () => ({
  createWorkosTeamClient: () => mocks.client,
}))
vi.mock('../src/teams/cleanup', () => ({
  completeWorkosCleanup: mocks.completeWorkosCleanup,
  drainWorkosCleanupOutbox: mocks.drainWorkosCleanupOutbox,
  enqueueWorkosCleanup: mocks.enqueueWorkosCleanup,
  opportunisticallyDrainWorkosCleanup: mocks.opportunisticallyDrainWorkosCleanup,
}))

import {
  onRequestDelete as archiveTeam,
  onRequestPatch as renameTeam,
} from '../functions/api/teams/[teamId]/index'
import { onRequestPost as resendInvitation } from '../functions/api/teams/[teamId]/invitations/[invitationId]/resend'
import { onRequestPost as inviteMember } from '../functions/api/teams/[teamId]/invitations/index'
import { onRequestPatch as updateMember } from '../functions/api/teams/[teamId]/members/[userId]'
import { onRequestPost as createTeam } from '../functions/api/teams/index'
import { ApiError } from '../src/errors'
import type { TeamApiEnv } from '../src/teams/env'
import {
  MAX_ACTIVE_TEAMS_CREATED_PER_USER,
  MAX_PENDING_INVITATIONS_PER_TEAM,
  TEAM_CREATE_RATE,
  TEAM_INVITATION_RATE,
  TEAM_NAME_UPDATE_RATE,
} from '../src/teams/limits'
import { invoke } from './_helpers/ctx'
import { makeKv } from './_helpers/fakes'

const TEAM_ID = 'team_00000000000000000000000000000000'
const INVITATION_ID = 'tinv_00000000000000000000000000000000'
const USER_ID = 'user_0000000000000000'
const MEMBER_ID = 'member_000000000000'
const TEAM_HANDLE = 'original-team-0000000000'
const TEAM_ROW = {
  id: TEAM_ID,
  workos_organization_id: 'org_1',
  name: 'Original',
  created_by_user_id: USER_ID,
  created_at: 1,
  updated_at: 1,
  deletion_pending_until: null,
  archived_at: null,
}

function env(): TeamApiEnv {
  return {
    DB: {} as D1Database,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    WORKOS_API_KEY: 'sk_test',
  }
}

async function exhaustRate(
  rateKv: TeamApiEnv['RATE'],
  rule: { bucket: string; windowSec: number; max: number },
  key: string,
): Promise<void> {
  const slot = Math.floor(Date.now() / 1000 / rule.windowSec)
  await rateKv.put(`rate/${rule.bucket}/${key}/${slot}`, String(rule.max), {
    expirationTtl: rule.windowSec * 2,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue({ id: USER_ID, email: 'owner@example.com' })
  mocks.completeWorkosCleanup.mockResolvedValue(undefined)
  mocks.drainWorkosCleanupOutbox.mockResolvedValue({ attempted: 0, completed: 0, failed: 0 })
  mocks.enqueueWorkosCleanup.mockResolvedValue(undefined)
  mocks.opportunisticallyDrainWorkosCleanup.mockResolvedValue(undefined)
  mocks.requireTeamAccess.mockResolvedValue({
    team: TEAM_ROW,
    membership: {
      team_id: TEAM_ID,
      user_id: USER_ID,
      role: 'owner',
      workos_membership_id: 'membership_owner',
      joined_at: 1,
      updated_at: 1,
    },
  })
  mocks.countActiveTeamsCreatedByUser.mockResolvedValue(0)
  mocks.assertHandleAvailable.mockResolvedValue(undefined)
  mocks.chooseAvailableTeamHandle.mockResolvedValue(TEAM_HANDLE)
  mocks.changeTeamHandle.mockResolvedValue(undefined)
  mocks.countPendingTeamInvitations.mockResolvedValue(0)
  mocks.createLocalInvitation.mockResolvedValue(true)
  mocks.createLocalTeam.mockResolvedValue(true)
  mocks.getTeamCreationRequest.mockResolvedValue(null)
  mocks.getTeamById.mockResolvedValue(null)
  mocks.beginTeamCreationRequest.mockImplementation(async (_db, args) => ({
    created: true,
    request: {
      user_id: args.userId,
      idempotency_key: args.idempotencyKey,
      team_id: args.teamId,
      normalized_name: args.name,
      requested_handle: args.requestedHandle,
      status: 'pending',
      workos_organization_id: null,
      created_at: args.now,
      updated_at: args.now,
    },
  }))
  mocks.adoptTeamCreationHandle.mockImplementation(
    async (_db, userId, idempotencyKey, requestedHandle, now) => ({
      user_id: userId,
      idempotency_key: idempotencyKey,
      team_id: TEAM_ID,
      normalized_name: 'Original',
      requested_handle: requestedHandle,
      status: 'pending',
      workos_organization_id: null,
      created_at: now,
      updated_at: now,
    }),
  )
  mocks.completeTeamCreationRequest.mockResolvedValue(undefined)
  mocks.failTeamCreationRequest.mockResolvedValue(true)
  mocks.recordTeamCreationOrganization.mockResolvedValue(undefined)
  mocks.getTeamForMember.mockResolvedValue({
    id: TEAM_ID,
    name: 'Original',
    role: 'owner',
    permissions: ['team:update', 'team:archive'],
    member_count: 1,
    handle: TEAM_HANDLE,
    archived_at: null,
  })
  mocks.getWorkosUserId.mockResolvedValue('workos_owner')
  mocks.hasTeamMemberWithEmail.mockResolvedValue(false)
  mocks.getTeamInvitation.mockResolvedValue(null)
  mocks.getTeamInvitationResponse.mockImplementation(async () =>
    mocks.getTeamInvitationResponse.mock.calls.length === 1
      ? null
      : {
          id: INVITATION_ID,
          email: 'member@example.com',
          role: 'member',
          status: 'pending',
        },
  )
  mocks.getTeamMembership.mockResolvedValue({
    team_id: TEAM_ID,
    user_id: MEMBER_ID,
    role: 'member',
    workos_membership_id: 'membership_member',
    joined_at: 1,
    updated_at: 1,
  })
  mocks.getUserById.mockResolvedValue({
    id: MEMBER_ID,
    deletion_pending_until: null,
  })
  mocks.insertInvitationProjection.mockResolvedValue(true)
  mocks.listTeamInvitations.mockResolvedValue([
    {
      id: INVITATION_ID,
      email: 'member@example.com',
      role: 'member',
      status: 'pending',
    },
  ])
  mocks.listTeamMembers.mockResolvedValue([])
  mocks.newTeamId.mockReturnValue(TEAM_ID)
  mocks.newTeamInvitationId.mockReturnValue(INVITATION_ID)
  mocks.beginTeamInvitationCreationRequest.mockImplementation(async (_db, args) => ({
    created: true,
    request: {
      team_id: args.teamId,
      invited_by_user_id: args.invitedByUserId,
      idempotency_key: args.idempotencyKey,
      invitation_id: args.invitationId,
      normalized_email: args.email,
      desired_role: args.desiredRole,
      status: 'pending',
      workos_invitation_id: null,
      created_at: args.now,
      updated_at: args.now,
    },
  }))
  mocks.completeTeamInvitationCreationRequest.mockResolvedValue(undefined)
  mocks.failTeamInvitationCreationRequest.mockResolvedValue(true)
  mocks.recordTeamInvitationCreationWorkosId.mockResolvedValue(undefined)
  mocks.getTeamInvitationCreationRequest.mockImplementation(
    async (_db, teamId, invitedByUserId, idempotencyKey) =>
      mocks.getTeamInvitationCreationRequest.mock.calls.length === 1
        ? null
        : {
            team_id: teamId,
            invited_by_user_id: invitedByUserId,
            idempotency_key: idempotencyKey,
            invitation_id: INVITATION_ID,
            normalized_email: 'member@example.com',
            desired_role: 'member',
            status: 'pending',
            workos_invitation_id: 'workos_invitation_1',
            created_at: 1,
            updated_at: 1,
          },
  )
  mocks.reconcileInvitationProjections.mockResolvedValue(undefined)
  mocks.removeLocalMembership.mockResolvedValue(true)
  mocks.countTeamOwners.mockResolvedValue(1)
  mocks.transferTeamOwnership.mockResolvedValue(true)
  mocks.updateMemberRole.mockResolvedValue(true)
  mocks.updateLocalTeamName.mockResolvedValue(true)
  mocks.archiveLocalTeam.mockResolvedValue(true)
  mocks.updateInvitationProjection.mockResolvedValue(undefined)
  mocks.client.createOrganization.mockResolvedValue({ id: 'org_1', name: 'Original' })
  mocks.client.getOrganizationByExternalId.mockRejectedValue(new ApiError('NOT_FOUND', 'not found'))
  mocks.client.createMembership.mockResolvedValue({ id: 'membership_owner' })
  mocks.client.listActiveMemberships.mockResolvedValue([])
  mocks.client.deleteMembership.mockResolvedValue(undefined)
  mocks.client.deleteOrganization.mockResolvedValue(undefined)
  mocks.client.updateOrganization.mockResolvedValue({ id: 'org_1', name: 'Renamed' })
  mocks.client.createInvitation.mockResolvedValue({ id: 'workos_invitation_1' })
  mocks.client.getInvitation.mockResolvedValue({ id: 'workos_invitation_1' })
  mocks.client.listInvitations.mockResolvedValue([])
  mocks.client.listAllInvitations.mockResolvedValue([])
  mocks.client.revokeInvitation.mockResolvedValue({ id: 'workos_invitation_1' })
  mocks.client.resendInvitation.mockResolvedValue({ id: 'workos_invitation_1' })
  mocks.audit.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Team SaaS limits', () => {
  it('caps active Teams created by one user before calling WorkOS', async () => {
    mocks.countActiveTeamsCreatedByUser.mockResolvedValue(MAX_ACTIVE_TEAMS_CREATED_PER_USER)
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-test-0001' },
        body: JSON.stringify({ name: 'Another Team' }),
      }),
      env(),
    )
    expect(response.status).toBe(409)
    expect(mocks.client.createOrganization).not.toHaveBeenCalled()
  })

  it('compensates if the transactional Team cap wins a concurrent race', async () => {
    mocks.createLocalTeam.mockResolvedValue(false)
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-test-0002' },
        body: JSON.stringify({ name: 'Racing Team' }),
      }),
      env(),
    )
    expect(response.status).toBe(409)
    expect(mocks.client.deleteOrganization).toHaveBeenCalledWith('org_1')
  })

  it('limits Team creation to five attempts per user each day', async () => {
    const bindings = env()
    await exhaustRate(bindings.RATE, TEAM_CREATE_RATE, USER_ID)
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-test-0003' },
        body: JSON.stringify({ name: 'Another Team' }),
      }),
      bindings,
    )
    expect(response.status).toBe(429)
    expect(mocks.countActiveTeamsCreatedByUser).not.toHaveBeenCalled()
  })

  it('limits Team renames to thirty per Team each hour', async () => {
    const bindings = env()
    await exhaustRate(bindings.RATE, TEAM_NAME_UPDATE_RATE, TEAM_ID)
    const response = await invoke(
      renameTeam,
      new Request(`https://spool.new/api/teams/${TEAM_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      bindings,
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(429)
    expect(mocks.client.updateOrganization).not.toHaveBeenCalled()
  })

  it('limits new invitations to one hundred per Team each day', async () => {
    const bindings = env()
    await exhaustRate(bindings.RATE, TEAM_INVITATION_RATE, TEAM_ID)
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-test-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      bindings,
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(429)
    expect(mocks.client.createInvitation).not.toHaveBeenCalled()
  })

  it('uses the same Team email budget for invitation resends', async () => {
    const bindings = env()
    await exhaustRate(bindings.RATE, TEAM_INVITATION_RATE, TEAM_ID)
    const response = await invoke(
      resendInvitation,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations/${INVITATION_ID}/resend`, {
        method: 'POST',
      }),
      bindings,
      { teamId: TEAM_ID, invitationId: INVITATION_ID },
    )
    expect(response.status).toBe(429)
    expect(mocks.getTeamInvitation).not.toHaveBeenCalled()
    expect(mocks.client.resendInvitation).not.toHaveBeenCalled()
  })

  it('reconciles upstream state before enforcing the pending invitation cap', async () => {
    mocks.countPendingTeamInvitations.mockResolvedValue(MAX_PENDING_INVITATIONS_PER_TEAM)
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-test-0002' },
        body: JSON.stringify({ email: 'member@example.com', role: 'admin' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(409)
    expect(mocks.client.listAllInvitations).toHaveBeenCalledWith('org_1')
    expect(mocks.reconcileInvitationProjections).toHaveBeenCalled()
    expect(mocks.client.createInvitation).not.toHaveBeenCalled()
  })

  it('revokes an upstream invite if the transactional pending cap wins a race', async () => {
    mocks.createLocalInvitation.mockResolvedValue(false)
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-test-0003' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(409)
    expect(mocks.failTeamInvitationCreationRequest).toHaveBeenCalled()
    expect(mocks.opportunisticallyDrainWorkosCleanup).toHaveBeenCalled()
  })
})

describe('WorkOS compensation', () => {
  it('leaves a transient local failure pending so the same key can resume safely', async () => {
    mocks.createLocalTeam.mockRejectedValue(new Error('D1 unavailable'))
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-test-0004' },
        body: JSON.stringify({ name: 'Broken Team' }),
      }),
      env(),
    )
    expect(response.status).toBe(500)
    expect(mocks.client.deleteOrganization).not.toHaveBeenCalled()
    expect(mocks.failTeamCreationRequest).not.toHaveBeenCalled()
  })

  it('leaves a transient invitation projection failure pending for same-key recovery', async () => {
    mocks.createLocalInvitation.mockRejectedValue(new Error('D1 unavailable'))
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-test-0004' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(500)
    expect(mocks.client.revokeInvitation).not.toHaveBeenCalled()
    expect(mocks.failTeamInvitationCreationRequest).not.toHaveBeenCalled()
  })

  it('restores the WorkOS name if local authorization changes during rename', async () => {
    mocks.updateLocalTeamName.mockResolvedValue(false)
    const response = await invoke(
      renameTeam,
      new Request(`https://spool.new/api/teams/${TEAM_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(403)
    expect(mocks.client.updateOrganization.mock.calls).toEqual([
      ['org_1', 'Renamed'],
      ['org_1', 'Original'],
    ])
  })
})

describe('Team creation idempotency', () => {
  it('rejects an occupied explicit handle before writing a receipt or calling WorkOS', async () => {
    mocks.assertHandleAvailable.mockRejectedValue(new ApiError('CONFLICT', 'handle taken'))

    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-handle-taken-0001' },
        body: JSON.stringify({ name: 'Original', handle: 'taken-handle' }),
      }),
      env(),
    )

    expect(response.status).toBe(409)
    expect(mocks.beginTeamCreationRequest).not.toHaveBeenCalled()
    expect(mocks.client.createOrganization).not.toHaveBeenCalled()
    expect(mocks.client.createMembership).not.toHaveBeenCalled()
  })

  it('commits the selected handle in the same local operation as the Team', async () => {
    mocks.getTeamForMember.mockResolvedValue({
      id: TEAM_ID,
      name: 'Original',
      role: 'owner',
      permissions: ['team:update', 'team:archive'],
      member_count: 1,
      handle: 'atomic-handle',
      archived_at: null,
    })
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-atomic-handle-0001' },
        body: JSON.stringify({ name: 'Original', handle: 'atomic-handle' }),
      }),
      env(),
    )

    expect(response.status).toBe(201)
    expect(mocks.createLocalTeam).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestedHandle: 'atomic-handle' }),
    )
    expect(mocks.changeTeamHandle).not.toHaveBeenCalled()
  })

  it('rejects the same idempotency key when its recorded handle intent differs', async () => {
    mocks.getTeamCreationRequest.mockResolvedValue({
      user_id: USER_ID,
      idempotency_key: 'team-create-handle-intent-0001',
      team_id: TEAM_ID,
      normalized_name: 'Original',
      requested_handle: 'first-handle',
      status: 'pending',
      workos_organization_id: null,
      created_at: 1,
      updated_at: 1,
    })

    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-handle-intent-0001' },
        body: JSON.stringify({ name: 'Original', handle: 'second-handle' }),
      }),
      env(),
    )

    expect(response.status).toBe(409)
    expect(mocks.client.createOrganization).not.toHaveBeenCalled()
    expect(mocks.client.createMembership).not.toHaveBeenCalled()
  })

  it('replays a completed browser operation without another WorkOS mutation', async () => {
    mocks.getTeamCreationRequest.mockResolvedValue({
      user_id: USER_ID,
      idempotency_key: 'team-create-replay-0001',
      team_id: TEAM_ID,
      normalized_name: 'Original',
      requested_handle: TEAM_HANDLE,
      status: 'completed',
      workos_organization_id: 'org_1',
      created_at: 1,
      updated_at: 1,
    })
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-replay-0001' },
        body: JSON.stringify({ name: 'Original' }),
      }),
      env(),
    )
    expect(response.status).toBe(200)
    expect(mocks.client.createOrganization).not.toHaveBeenCalled()
    expect(mocks.client.createMembership).not.toHaveBeenCalled()
    expect(mocks.changeTeamHandle).not.toHaveBeenCalled()
  })

  it('treats a same-key concurrent local commit as success and never deletes its Organization', async () => {
    mocks.createLocalTeam.mockRejectedValue(new Error('UNIQUE constraint failed'))
    mocks.getTeamById.mockResolvedValue(TEAM_ROW)
    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-race-0001' },
        body: JSON.stringify({ name: 'Original' }),
      }),
      env(),
    )
    expect(response.status).toBe(200)
    expect(mocks.completeTeamCreationRequest).toHaveBeenCalled()
    expect(mocks.failTeamCreationRequest).not.toHaveBeenCalled()
    expect(mocks.client.deleteOrganization).not.toHaveBeenCalled()
  })

  it('compensates WorkOS when another operation wins the atomic handle claim', async () => {
    mocks.createLocalTeam.mockRejectedValue(new Error('UNIQUE constraint failed: handles.handle'))
    mocks.getTeamById.mockResolvedValue(null)

    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-handle-race-0001' },
        body: JSON.stringify({ name: 'Original', handle: 'racing-handle' }),
      }),
      env(),
    )

    expect(response.status).toBe(409)
    expect(mocks.failTeamCreationRequest).toHaveBeenCalled()
    expect(mocks.client.deleteOrganization).toHaveBeenCalledWith('org_1')
    expect(mocks.completeWorkosCleanup).toHaveBeenCalledWith(
      expect.anything(),
      'organization.delete',
      'org_1',
    )
  })

  it('repairs a pre-handle receipt once and then completes it', async () => {
    mocks.getTeamCreationRequest.mockResolvedValue({
      user_id: USER_ID,
      idempotency_key: 'team-create-legacy-handle-0001',
      team_id: TEAM_ID,
      normalized_name: 'Original',
      requested_handle: null,
      status: 'pending',
      workos_organization_id: 'org_1',
      created_at: 1,
      updated_at: 1,
    })
    mocks.adoptTeamCreationHandle.mockResolvedValue({
      user_id: USER_ID,
      idempotency_key: 'team-create-legacy-handle-0001',
      team_id: TEAM_ID,
      normalized_name: 'Original',
      requested_handle: TEAM_HANDLE,
      status: 'pending',
      workos_organization_id: 'org_1',
      created_at: 1,
      updated_at: 2,
    })
    const withoutHandle = {
      id: TEAM_ID,
      name: 'Original',
      role: 'owner',
      permissions: ['team:update', 'team:archive'],
      member_count: 1,
      handle: null,
      archived_at: null,
    }
    const withHandle = { ...withoutHandle, handle: TEAM_HANDLE }
    mocks.getTeamForMember
      .mockResolvedValueOnce(withoutHandle)
      .mockResolvedValueOnce(withoutHandle)
      .mockResolvedValueOnce(withHandle)

    const response = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-legacy-handle-0001' },
        body: JSON.stringify({ name: 'Original' }),
      }),
      env(),
    )

    expect(response.status).toBe(200)
    expect(mocks.adoptTeamCreationHandle).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'team-create-legacy-handle-0001',
      TEAM_HANDLE,
      expect.any(Number),
    )
    expect(mocks.changeTeamHandle).toHaveBeenCalledWith(expect.anything(), {
      teamId: TEAM_ID,
      actorUserId: USER_ID,
      handle: TEAM_HANDLE,
      now: expect.any(Number),
    })
    expect(mocks.completeTeamCreationRequest).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'team-create-legacy-handle-0001',
      TEAM_ID,
      TEAM_HANDLE,
      expect.any(Number),
    )
    expect(mocks.client.createOrganization).not.toHaveBeenCalled()
  })
})

describe('Team invitation idempotency', () => {
  it('rejects an existing member email before creating or adopting a WorkOS invitation', async () => {
    mocks.hasTeamMemberWithEmail.mockResolvedValue(true)
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-existing-member-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )

    expect(response.status).toBe(409)
    expect(mocks.beginTeamInvitationCreationRequest).not.toHaveBeenCalled()
    expect(mocks.client.createInvitation).not.toHaveBeenCalled()
    expect(mocks.client.listAllInvitations).not.toHaveBeenCalled()
    expect(mocks.failTeamInvitationCreationRequest).not.toHaveBeenCalled()
  })

  it('never adopts or compensates a historic same-email invite after WorkOS conflict', async () => {
    mocks.client.createInvitation.mockRejectedValue(new ApiError('CONFLICT', 'already invited'))
    mocks.client.listAllInvitations.mockResolvedValue([
      {
        id: 'historic_accepted_invitation',
        email: 'member@example.com',
        state: 'accepted',
        accepted_user_id: 'workos_existing_member',
      },
    ])
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-conflict-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )

    expect(response.status).toBe(409)
    expect(mocks.client.listAllInvitations).not.toHaveBeenCalled()
    expect(mocks.recordTeamInvitationCreationWorkosId).not.toHaveBeenCalled()
    expect(mocks.failTeamInvitationCreationRequest).not.toHaveBeenCalled()
    expect(mocks.opportunisticallyDrainWorkosCleanup).not.toHaveBeenCalled()
  })

  it('does not compensate when the final local gate observes a concurrent member', async () => {
    mocks.hasTeamMemberWithEmail.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mocks.createLocalInvitation.mockResolvedValue(false)
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-member-race-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )

    expect(response.status).toBe(409)
    expect(mocks.failTeamInvitationCreationRequest).not.toHaveBeenCalled()
    expect(mocks.opportunisticallyDrainWorkosCleanup).not.toHaveBeenCalled()
  })

  it('resumes a lost WorkOS response for an already-synced member using the stable key', async () => {
    mocks.getTeamInvitationCreationRequest
      .mockResolvedValueOnce({
        team_id: TEAM_ID,
        invited_by_user_id: USER_ID,
        idempotency_key: 'team-invite-lost-response-0001',
        invitation_id: INVITATION_ID,
        normalized_email: 'member@example.com',
        desired_role: 'admin',
        status: 'pending',
        workos_invitation_id: null,
        created_at: 1,
        updated_at: 1,
      })
      .mockResolvedValueOnce({
        team_id: TEAM_ID,
        invited_by_user_id: USER_ID,
        idempotency_key: 'team-invite-lost-response-0001',
        invitation_id: INVITATION_ID,
        normalized_email: 'member@example.com',
        desired_role: 'admin',
        status: 'pending',
        workos_invitation_id: 'workos_invitation_exact',
        created_at: 1,
        updated_at: 2,
      })
    mocks.hasTeamMemberWithEmail.mockResolvedValue(true)
    mocks.client.createInvitation.mockResolvedValue({
      id: 'workos_invitation_exact',
      email: 'member@example.com',
      state: 'pending',
      organization_id: 'org_1',
      accepted_user_id: null,
      created_at: '2026-07-22T00:00:00.000Z',
      updated_at: '2026-07-22T00:00:00.000Z',
    })
    mocks.client.getInvitation.mockResolvedValue({
      id: 'workos_invitation_exact',
      email: 'member@example.com',
      state: 'accepted',
      organization_id: 'org_1',
      accepted_user_id: 'workos_member',
      created_at: '2026-07-22T00:00:00.000Z',
      updated_at: '2026-07-22T00:01:00.000Z',
    })
    mocks.getTeamInvitationResponse.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: INVITATION_ID,
      email: 'member@example.com',
      role: 'admin',
      status: 'accepted',
    })

    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-lost-response-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'admin' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )

    expect(response.status).toBe(200)
    expect(mocks.hasTeamMemberWithEmail).not.toHaveBeenCalled()
    expect(mocks.client.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `spool-team-invitation-${INVITATION_ID}` }),
    )
    expect(mocks.recordTeamInvitationCreationWorkosId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workosInvitationId: 'workos_invitation_exact' }),
    )
    expect(mocks.client.getInvitation).toHaveBeenCalledWith('workos_invitation_exact')
    expect(mocks.createLocalInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ desiredRole: 'admin' }),
    )
  })

  it('replays a completed browser operation without another WorkOS mutation', async () => {
    mocks.getTeamInvitationCreationRequest.mockResolvedValue({
      team_id: TEAM_ID,
      invited_by_user_id: USER_ID,
      idempotency_key: 'team-invite-replay-0001',
      invitation_id: INVITATION_ID,
      normalized_email: 'member@example.com',
      desired_role: 'member',
      status: 'completed',
      workos_invitation_id: 'workos_invitation_1',
      created_at: 1,
      updated_at: 1,
    })
    mocks.getTeamInvitationResponse.mockResolvedValue({
      id: INVITATION_ID,
      email: 'member@example.com',
      role: 'member',
      status: 'pending',
    })
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-replay-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(200)
    expect(mocks.client.createInvitation).not.toHaveBeenCalled()
    expect(mocks.client.getInvitation).not.toHaveBeenCalled()
  })

  it('resumes a recorded upstream invitation instead of sending a second email', async () => {
    mocks.getTeamInvitationCreationRequest.mockResolvedValue({
      team_id: TEAM_ID,
      invited_by_user_id: USER_ID,
      idempotency_key: 'team-invite-resume-0001',
      invitation_id: INVITATION_ID,
      normalized_email: 'member@example.com',
      desired_role: 'member',
      status: 'pending',
      workos_invitation_id: 'workos_invitation_1',
      created_at: 1,
      updated_at: 1,
    })
    const response = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-resume-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(200)
    expect(mocks.client.getInvitation).toHaveBeenCalledWith('workos_invitation_1')
    expect(mocks.client.createInvitation).not.toHaveBeenCalled()
  })
})

describe('Team archive privacy ordering', () => {
  it('keeps the successful local archive when WorkOS cleanup is transiently unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.client.deleteOrganization.mockRejectedValue(new Error('WorkOS unavailable'))
    const response = await invoke(
      archiveTeam,
      new Request(`https://spool.new/api/teams/${TEAM_ID}`, { method: 'DELETE' }),
      env(),
      { teamId: TEAM_ID },
    )
    expect(response.status).toBe(200)
    expect(mocks.archiveLocalTeam).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      USER_ID,
      expect.any(Number),
    )
    expect(mocks.archiveLocalTeam.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.client.deleteOrganization.mock.invocationCallOrder[0]!,
    )
    expect(consoleError).toHaveBeenCalled()
  })

  it('returns the committed archive when post-commit audit delivery fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.audit.mockRejectedValue(new Error('audit unavailable'))

    const response = await invoke(
      archiveTeam,
      new Request(`https://spool.new/api/teams/${TEAM_ID}`, { method: 'DELETE' }),
      env(),
      { teamId: TEAM_ID },
    )

    expect(response.status).toBe(200)
    expect(mocks.archiveLocalTeam).toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('post-commit audit failed'))
  })
})

describe('post-commit audit isolation', () => {
  it('keeps create, invite, and resend responses successful when audit delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.audit.mockRejectedValue(new Error('audit unavailable'))

    const created = await invoke(
      createTeam,
      new Request('https://spool.new/api/teams', {
        method: 'POST',
        headers: { 'idempotency-key': 'team-create-audit-failure-0001' },
        body: JSON.stringify({ name: 'Audit Safe Team' }),
      }),
      env(),
    )
    const invited = await invoke(
      inviteMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations`, {
        method: 'POST',
        headers: { 'idempotency-key': 'team-invite-audit-failure-0001' },
        body: JSON.stringify({ email: 'member@example.com', role: 'member' }),
      }),
      env(),
      { teamId: TEAM_ID },
    )
    mocks.getTeamInvitation.mockResolvedValue({
      id: INVITATION_ID,
      workos_invitation_id: 'workos_invitation_1',
      team_id: TEAM_ID,
      email: 'member@example.com',
      desired_role: 'member',
      status: 'pending',
      invited_by_user_id: USER_ID,
      accepted_workos_user_id: null,
      expires_at: null,
      accepted_at: null,
      revoked_at: null,
      created_at: 1,
      updated_at: 1,
    })
    const resent = await invoke(
      resendInvitation,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/invitations/${INVITATION_ID}/resend`, {
        method: 'POST',
      }),
      env(),
      { teamId: TEAM_ID, invitationId: INVITATION_ID },
    )

    expect(created.status).toBe(201)
    expect(invited.status).toBe(201)
    expect(resent.status).toBe(200)
  })
})

describe('ownership transfer safety', () => {
  it('rejects a target whose account deletion is pending', async () => {
    mocks.getUserById.mockResolvedValue({
      id: MEMBER_ID,
      deletion_pending_until: Date.now() + 60_000,
    })
    const response = await invoke(
      updateMember,
      new Request(`https://spool.new/api/teams/${TEAM_ID}/members/${MEMBER_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'owner' }),
      }),
      env(),
      { teamId: TEAM_ID, userId: MEMBER_ID },
    )
    expect(response.status).toBe(409)
    expect(mocks.transferTeamOwnership).not.toHaveBeenCalled()
  })
})
