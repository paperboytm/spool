export type SessionSource = 'claude' | 'codex' | 'gemini'
export type Source = SessionSource
export type SearchMatchType = 'fts' | 'phrase' | 'all_terms'

export interface ParsedMessage {
  uuid: string
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  contentText: string
  timestamp: string
  isSidechain: boolean
  toolNames: string[]
  seq: number
}

export interface ParsedSession {
  source: SessionSource
  sessionUuid: string
  filePath: string
  title: string
  cwd: string
  model: string
  startedAt: string
  endedAt: string
  messages: ParsedMessage[]
}

export type ParseSessionResult =
  | { kind: 'parsed'; session: ParsedSession }
  | { kind: 'filtered' }
  | { kind: 'skipped' }

export interface Session {
  id: number
  projectId: number
  sourceId: number
  sessionUuid: string
  filePath: string
  title: string | null
  startedAt: string
  endedAt: string
  messageCount: number
  hasToolUse: boolean
  cwd: string | null
  model: string | null
  source: SessionSource
  projectDisplayPath: string
  projectDisplayName: string
  /** Denormalised count of active findings (any severity) for this
   *  session. 0 when the session has been scanned and is clean, or
   *  when scan has not yet run on it. Drives the Library row badge. */
  scanFindingCount: number
  /** Subset of scanFindingCount limited to HIGH_SEVERITY_KINDS. */
  scanHighCount: number
}

export type ProjectIdentityKind =
  | 'git_remote'
  | 'git_common_dir'
  | 'manifest_path'
  | 'synthetic'
  | 'path'
  | 'loose'
  | 'spool_internal'

export interface ProjectIdentity {
  kind: ProjectIdentityKind
  key: string                       // normalized origin URL / abs path / 'loose'
  displayName: string
  // Optional override for the project row's display_path. Used by synthetic
  // identities to publish a stable header path (e.g. "~/Documents/Codex")
  // instead of leaking the per-session scratch dir of whichever chat was
  // synced first.
  displayPath?: string
}

export interface ProjectGroup {
  identityKind: ProjectIdentityKind
  identityKey: string
  displayName: string
  sources: SessionSource[]          // unique sources contributing
  sessionCount: number
  lastSessionAt: string | null
}

export interface Message {
  id: number
  sessionId: number
  msgUuid: string | null
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  contentText: string
  timestamp: string
  isSidechain: boolean
  toolNames: string[]
  seq: number
}

export interface FragmentResult {
  rank: number
  sessionId: number
  sessionUuid: string
  sessionTitle: string
  matchCount: number
  matchType: SearchMatchType
  source: SessionSource
  profileLabel?: string
  cwd?: string
  project: string
  startedAt: string
  snippet: string
  messageId: number
  messageRole: string
  messageTimestamp: string
}

export interface StatusInfo {
  dbPath: string
  totalSessions: number
  claudeSessions: number
  codexSessions: number
  geminiSessions: number
  lastSyncedAt: string | null
  dbSizeBytes: number
}

export interface SyncResult {
  added: number
  updated: number
  errors: number
}

// ── Search ──────────────────────────────────────────────────────────────────

export type SearchResult = FragmentResult & { kind: 'fragment' }

