export const SESSION_PROVIDERS = ['claude', 'codex', 'gemini', 'opencode', 'pi'] as const
export type SessionProvider = (typeof SESSION_PROVIDERS)[number]

export const RESUMABLE_SESSION_PROVIDERS = ['claude', 'codex'] as const
export type ResumableSessionProvider = (typeof RESUMABLE_SESSION_PROVIDERS)[number]

/** Providers whose Hub shares are published to Explore by default. Keep this
 * policy separate from Resume support even though the initial sets match. */
export const DISCOVERY_SESSION_PROVIDERS = ['claude', 'codex'] as const
export type DiscoverySessionProvider = (typeof DISCOVERY_SESSION_PROVIDERS)[number]

export const SESSION_PROVIDER_LABELS: Record<SessionProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  pi: 'Pi',
}

export function isSessionProvider(value: unknown): value is SessionProvider {
  return typeof value === 'string' && (SESSION_PROVIDERS as readonly string[]).includes(value)
}

export function isResumableSessionProvider(
  value: SessionProvider,
): value is ResumableSessionProvider {
  return (RESUMABLE_SESSION_PROVIDERS as readonly SessionProvider[]).includes(value)
}

export function isDiscoverySessionProvider(value: unknown): value is DiscoverySessionProvider {
  return (
    typeof value === 'string' && (DISCOVERY_SESSION_PROVIDERS as readonly string[]).includes(value)
  )
}

export function isDiscoverySessionSid(sid: string): boolean {
  const separator = sid.indexOf('_')
  return separator > 0 && isDiscoverySessionProvider(sid.slice(0, separator))
}

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface CanonicalizeOptions {
  workspaceRoot?: string
  homeDir?: string
}

export interface CanonicalRecord {
  oid: string
  data: string
}

/**
 * A record fetched sparsely (e.g. the reader pulling only a file's edit
 * records from the hub): `i` is the record's position in the full
 * sequence and overrides the array position for index attribution.
 */
export interface IndexedRecord {
  i: number
  data: string
}

export type SessionRecord = string | CanonicalRecord | IndexedRecord

export interface SessionRecordsOptions {
  provider: SessionProvider
  workspaceRoot?: string
}

export type EditTool = 'Edit' | 'Write' | 'MultiEdit' | 'NotebookEdit' | 'apply_patch'

export interface TextReplacement {
  oldText: string
  newText: string
  replaceAll?: boolean
  oldStart?: number
  oldLines?: number
  newStart?: number
  newLines?: number
}

export interface EditEvent {
  provider: SessionProvider
  recordIndex: number
  resultRecordIndex: number
  tool: EditTool
  path: string
  timestamp?: string
  before?: string
  after?: string
  replacements: TextReplacement[]
}

export type ViewRecordKind = 'user' | 'assistant' | 'tool' | 'edit' | 'other'

export interface ViewIndexEntry {
  i: number
  kind: ViewRecordKind
  size: number
  ts?: string
  file?: string
  tool?: string
  excerpt?: string
}

export interface ViewFileEntry {
  path: string
  /**
   * Every record index needed to reconstruct this file's edits client-side:
   * tool-call records and their paired result records.
   */
  events: number[]
  adds: number
  dels: number
}

export interface ViewOutlineEntry {
  i: number
  excerpt: string
}

export interface Diffstat {
  files: number
  adds: number
  dels: number
}

export interface SessionViewV1 {
  v: 1
  index: ViewIndexEntry[]
  files: ViewFileEntry[]
  outline: ViewOutlineEntry[]
  firstPrompt: string
  lastReply: string
  diffstat: Diffstat
}

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  recordIndices: number[]
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  recordIndices: number[]
}

export interface SessionFileDiff {
  path: string
  events: number[]
  oldText: string
  newText: string
  hunks: DiffHunk[]
  adds: number
  dels: number
}

export interface SessionDiff {
  files: SessionFileDiff[]
  diffstat: Diffstat
}
