// Renderer ↔ main contract for one-click hub sharing (the v2 records
// share — distinct from the v1 styled-snapshot publish in share-publish.ts).

export interface HubShareSecretsSummary {
  total: number
  high: number
  byKind: [string, number][]
}

export interface HubSharePrepared {
  sid: string
  count: number
  files: number
  adds: number
  dels: number
  secrets: HubShareSecretsSummary
  summaryPrefill: string
}

export type HubSharePrepareResult =
  | { ok: true; prepared: HubSharePrepared }
  | { ok: false; error: string }

export type HubShareVisibility = 'public' | 'link-only' | 'team'

export interface HubShareTeam {
  id: string
  name: string
}

/**
 * The default target deliberately has no persisted workspace value. Every
 * Share dialog starts here so a Team can never become a hidden sticky target.
 */
export type HubShareTarget = { visibility: 'default' } | { visibility: 'team'; teamId: string }

export type HubShareTeamsResult =
  | { ok: true; teams: HubShareTeam[] }
  | { ok: false; error: 'UNAUTHENTICATED' | string }

export type HubSharePublishResult =
  | { ok: true; url: string; visibility: HubShareVisibility }
  | { ok: false; error: 'UNAUTHENTICATED' | string }

export type HubShareWithdrawResult = { ok: true } | { ok: false; error: 'UNAUTHENTICATED' | string }
