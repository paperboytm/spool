export const SESSION_PROVIDERS = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'zcode'] as const
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
  zcode: 'ZCode',
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

export interface SessionUsageModelTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface SessionUsageV1 {
  /** Totals per model id, e.g. "claude-sonnet-4-5-20250929". */
  models: Record<string, SessionUsageModelTotals>
  /** Number of records that carried usage data. */
  records: number
}

/**
 * One human-authored instruction and the primary agent activity that followed
 * it, ending immediately before the next human instruction. Record indices
 * keep the projection compact: readers fetch prompts in one sparse batch and
 * fetch the full agent prose only when its disclosure is opened.
 */
export interface SessionGuidanceTurnV1 {
  promptRecord: number
  replyRecords: number[]
  /** Unicode code points across the trimmed, human-visible agent replies. */
  replyChars: number
  /** Provider tool-call records only; result/output records are excluded. */
  toolCalls: number
}

export interface SessionGuidanceV1 {
  v: 1
  turns: SessionGuidanceTurnV1[]
}

/**
 * Runtime guard for guidance loaded independently of a current Session view
 * (including legacy database projections). Besides field types, enforce the
 * sequence invariants sparse range reads rely on.
 */
export function isSessionGuidanceV1(value: unknown): value is SessionGuidanceV1 {
  if (!isUnknownRecord(value) || value['v'] !== 1 || !Array.isArray(value['turns'])) return false

  const turns = value['turns']
  let previousPrompt = -1
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex]
    if (
      !isUnknownRecord(turn) ||
      !isNonNegativeSafeInteger(turn['promptRecord']) ||
      !Array.isArray(turn['replyRecords']) ||
      !isNonNegativeSafeInteger(turn['replyChars']) ||
      !isNonNegativeSafeInteger(turn['toolCalls'])
    ) {
      return false
    }

    const promptRecord = turn['promptRecord']
    if (promptRecord <= previousPrompt) return false
    previousPrompt = promptRecord

    let previousReply = promptRecord
    for (const replyRecord of turn['replyRecords']) {
      if (!isNonNegativeSafeInteger(replyRecord) || replyRecord <= previousReply) return false
      previousReply = replyRecord
    }
  }

  for (let turnIndex = 0; turnIndex + 1 < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex] as Record<string, unknown>
    const next = turns[turnIndex + 1] as Record<string, unknown>
    const nextPrompt = next['promptRecord'] as number
    const replyRecords = turn['replyRecords'] as number[]
    if (replyRecords.some((replyRecord) => replyRecord >= nextPrompt)) return false
  }

  return true
}

export interface SessionViewV1 {
  v: 1
  index: ViewIndexEntry[]
  files: ViewFileEntry[]
  outline: ViewOutlineEntry[]
  firstPrompt: string
  lastReply: string
  diffstat: Diffstat
  /** Present only when at least one record carried token usage data. */
  usage?: SessionUsageV1
  /** Additive in v1 so older published view objects remain readable. */
  guidance?: SessionGuidanceV1
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
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
