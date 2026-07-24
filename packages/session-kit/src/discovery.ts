import type { SessionProvider } from './types.js'

/** Public Explore API v1. Shared Sessions are discoverable by default in v1. */
export type DiscoverySort = 'recommended' | 'trending' | 'recent'

export interface DiscoveryAuthor {
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface DiscoveryEvidence {
  records: number
  messages: number
  toolCalls: number
  files: number
  additions: number
  deletions: number
}

export interface DiscoveryLineage {
  sourceSid: string
}

export interface DiscoverySessionItem {
  sid: string
  title: string
  /** Bilingual task-outcome titles from the summary front-matter. */
  titles?: { en?: string; zh?: string }
  /** Estimated API cost from recorded token usage; absent for legacy rows. */
  cost?: { usd: number | null; totalTokens: number } | null
  /** Plain text, bounded for feed rendering; never Markdown. */
  summaryExcerpt: string | null
  agent: SessionProvider
  author: DiscoveryAuthor
  evidence: DiscoveryEvidence
  lineage: DiscoveryLineage | null
  publishedAt: number
  updatedAt: number
}

export interface DiscoverySessionsResponse {
  version: 1
  items: DiscoverySessionItem[]
  /** Opaque to clients. Null means the current result set is exhausted. */
  nextCursor: string | null
}

export interface DiscoveryEngagementRequest {
  kind: 'qualified_read'
}

export interface DiscoveryEngagementResponse {
  /** False when this reader/session/day was already counted. */
  accepted: boolean
}
