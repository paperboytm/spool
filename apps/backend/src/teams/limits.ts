export const MAX_ACTIVE_TEAMS_CREATED_PER_USER = 20
export const MAX_PENDING_INVITATIONS_PER_TEAM = 100
export const MAX_TEAM_MEMBERS_AND_PENDING = 500
export const MAX_TEAM_MEMBER_LIST_RESULTS = 500
export const MAX_TEAM_INVITATION_LIST_RESULTS = 500
export const MAX_TEAM_LIST_RESULTS = 100

export const TEAM_CREATE_RATE = {
  bucket: 'team-create',
  windowSec: 24 * 60 * 60,
  max: 5,
} as const

export const TEAM_INVITATION_RATE = {
  bucket: 'team-invitation-create',
  windowSec: 24 * 60 * 60,
  max: 100,
} as const

export const TEAM_NAME_UPDATE_RATE = {
  bucket: 'team-name-update',
  windowSec: 60 * 60,
  max: 30,
} as const
