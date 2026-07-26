import type { SessionSummaries } from './summary.js'
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

/** Public Project identity attached to a Public Session. */
export interface DiscoveryProject {
  id: string
  slug: string
  name: string
  /**
   * Canonical Project namespace. Older servers omitted this for personal
   * Projects, so clients should fall back to the Session author handle.
   */
  owner?: {
    kind: 'user' | 'team'
    handle: string
  }
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
  /** Bilingual plain-text excerpts; absent for legacy single-language rows. */
  summaryExcerpts?: SessionSummaries
  /** Live count of stars; absent only during a rolling backend upgrade. */
  starCount?: number
  agent: SessionProvider
  author: DiscoveryAuthor
  /** Public Project grouping for this Public Session. */
  project?: DiscoveryProject | null
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

/** Public social state for one currently live Public Session. */
export interface DiscoverySessionSocialResponse {
  version: 1
  starCount: number
  /**
   * Direct child Sessions that are themselves currently Public. A local
   * Resume is not counted until its resulting Session is published.
   */
  forkCount: number
  /** False for anonymous viewers and true only for the signed-in viewer's star. */
  viewerStarred: boolean
  /** Whether this viewer may currently change their star state. */
  canStar: boolean
}
