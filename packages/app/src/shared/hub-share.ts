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
  notePrefill: string
}

export type HubSharePrepareResult =
  | { ok: true; prepared: HubSharePrepared }
  | { ok: false; error: string }

export type HubSharePublishResult =
  | { ok: true; url: string }
  | { ok: false; error: 'UNAUTHENTICATED' | string }
