export type TeamRole = 'owner' | 'admin' | 'member'

export const TEAM_PERMISSIONS = [
  'team:update',
  'team:archive',
  'members:invite',
  'members:manage',
  'sessions:manage',
  'team:leave',
] as const

export type TeamPermission = (typeof TEAM_PERMISSIONS)[number]

const ROLE_PERMISSIONS: Record<TeamRole, readonly TeamPermission[]> = {
  owner: TEAM_PERMISSIONS,
  admin: ['team:update', 'members:invite', 'members:manage', 'sessions:manage', 'team:leave'],
  member: ['team:leave'],
}

export function permissionsForRole(role: TeamRole): TeamPermission[] {
  return [...ROLE_PERMISSIONS[role]]
}

export function hasTeamPermission(role: TeamRole, permission: TeamPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function isTeamRole(value: unknown): value is TeamRole {
  return value === 'owner' || value === 'admin' || value === 'member'
}

export function isInvitableTeamRole(value: unknown): value is Exclude<TeamRole, 'owner'> {
  return value === 'admin' || value === 'member'
}

export type TeamRow = {
  id: string
  workos_organization_id: string
  name: string
  created_by_user_id: string
  created_at: number
  updated_at: number
  deletion_pending_until: number | null
  archived_at: number | null
}

export type TeamMembershipRow = {
  team_id: string
  user_id: string
  role: TeamRole
  workos_membership_id: string | null
  workos_updated_at?: number | null
  joined_at: number
  updated_at: number
}

export type TeamInvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export const TEAM_MEMBER_PERMISSIONS = ['role:update', 'remove', 'ownership:transfer'] as const

export type TeamMemberPermission = (typeof TEAM_MEMBER_PERMISSIONS)[number]

export type TeamInvitationRow = {
  id: string
  workos_invitation_id: string
  team_id: string
  email: string
  desired_role: Exclude<TeamRole, 'owner'>
  status: TeamInvitationStatus
  invited_by_user_id: string
  accepted_workos_user_id: string | null
  expires_at: number | null
  accepted_at: number | null
  revoked_at: number | null
  created_at: number
  updated_at: number
}

export type TeamResponse = {
  id: string
  name: string
  role: TeamRole
  permissions: TeamPermission[]
  member_count: number
  archived_at: number | null
}

export type TeamMemberResponse = {
  user_id: string
  email: string
  display_name: string
  avatar_url?: string
  role: TeamRole
  permissions: TeamMemberPermission[]
  joined_at: number
}

export type TeamInvitationResponse = {
  id: string
  email: string
  role: Exclude<TeamRole, 'owner'>
  status: TeamInvitationStatus
  expires_at?: number
}
