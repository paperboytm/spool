import type { ResumableSessionProvider } from '@spool-lab/session-kit'

import { buildBirthText, type BirthPayload } from './birth.js'

// Resume materialization: turn hub records back into a fresh
// provider-native session file. The original session is never modified —
// a new UUID is minted, the provider's session-identity fields are
// rewritten, the $SPOOL_WS/$SPOOL_HOME placeholders map to the resumer's
// paths, and exactly one clearly-marked Spool birth record is appended.
// The file is written where the provider CLI keeps sessions for the
// target workspace, and is launched through the provider's native FORK
// entry point (`claude --resume --fork-session` / `codex fork`), so the
// materialized file stays an immutable anchor: it keeps folding to the
// shared integrity root forever, and re-running the printed command
// branches another fresh session off the share point.

export interface MaterializeOptions {
  records: readonly { i: number; data: string }[]
  sessionId: string
  workspaceRoot: string
  homeDir: string
  birth: BirthPayload
  cardJson: string | null
  now?: Date
}

export interface MaterializedSession {
  /** JSONL lines, ready to be joined with '\n'. */
  lines: string[]
  /** Directory the file belongs in, as path segments under the resumer's home. */
  dirSegments: string[]
  fileName: string
  /** The provider-native fork invocation, e.g. ['claude', '--resume', <id>, '--fork-session']. */
  resumeArgv: string[]
}

export function materializeSession(
  provider: ResumableSessionProvider,
  opts: MaterializeOptions,
): MaterializedSession {
  return provider === 'codex' ? materializeCodexSession(opts) : materializeClaudeSession(opts)
}

export function materializeClaudeSession(opts: MaterializeOptions): MaterializedSession {
  const sorted = [...opts.records].sort((a, b) => a.i - b.i)
  const lines: string[] = []
  let lastUuid: string | null = null
  let lastCwd: string | null = null

  for (const record of sorted) {
    const parsed = parseRecordObject(
      restorePlaceholders(record.data, opts.workspaceRoot, opts.homeDir),
      record.i,
    )
    if ('sessionId' in parsed) parsed['sessionId'] = opts.sessionId
    if (typeof parsed['uuid'] === 'string') lastUuid = parsed['uuid']
    if (typeof parsed['cwd'] === 'string') lastCwd = parsed['cwd']
    lines.push(JSON.stringify(parsed))
  }

  const now = (opts.now ?? new Date()).toISOString()
  const birthRecord = {
    type: 'user',
    uuid: crypto.randomUUID(),
    parentUuid: lastUuid,
    sessionId: opts.sessionId,
    timestamp: now,
    cwd: lastCwd ?? opts.workspaceRoot,
    message: {
      role: 'user',
      content: [{ type: 'text', text: buildBirthText(opts.birth, opts.cardJson) }],
    },
  }
  lines.push(JSON.stringify(birthRecord))

  return {
    lines,
    dirSegments: ['.claude', 'projects', claudeProjectDirName(opts.workspaceRoot)],
    fileName: `${opts.sessionId}.jsonl`,
    resumeArgv: ['claude', '--resume', opts.sessionId, '--fork-session'],
  }
}

export function materializeCodexSession(opts: MaterializeOptions): MaterializedSession {
  const sorted = [...opts.records].sort((a, b) => a.i - b.i)
  const lines: string[] = []

  for (const record of sorted) {
    const parsed = parseRecordObject(
      restorePlaceholders(record.data, opts.workspaceRoot, opts.homeDir),
      record.i,
    )
    // The rollout's identity lives in session_meta.payload — `id` on older
    // CLIs, plus a `session_id` alias on ≥0.144 — and `codex resume`
    // additionally matches the uuid in the file name. Rewrite every copy
    // so they can't disagree.
    if (parsed['type'] === 'session_meta') {
      const payload = parsed['payload']
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        const meta = payload as Record<string, unknown>
        meta['id'] = opts.sessionId
        if ('session_id' in meta) meta['session_id'] = opts.sessionId
      }
    }
    lines.push(JSON.stringify(parsed))
  }

  const iso = (opts.now ?? new Date()).toISOString()
  const birthRecord = {
    timestamp: iso,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: buildBirthText(opts.birth, opts.cardJson) }],
    },
  }
  lines.push(JSON.stringify(birthRecord))

  // Codex partitions rollouts by date: sessions/YYYY/MM/DD/rollout-<stamp>-<uuid>.jsonl.
  // `codex fork` copies the anchor into a new rollout whose session_meta
  // carries forked_from_id — codex's own lineage pointer back to it.
  const stamp = iso.slice(0, 19).replace(/:/g, '-')
  return {
    lines,
    dirSegments: ['.codex', 'sessions', iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)],
    fileName: `rollout-${stamp}-${opts.sessionId}.jsonl`,
    resumeArgv: ['codex', 'fork', opts.sessionId],
  }
}

function parseRecordObject(restored: string, index: number): Record<string, unknown> {
  try {
    const value = JSON.parse(restored) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('record is not an object')
    }
    return value as Record<string, unknown>
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Record ${index} is not valid JSON: ${message}`)
  }
}

/**
 * Replace canonicalization placeholders with the resumer's local paths.
 * Tokens live inside JSON string values, so the replacement must be
 * JSON-escaped before splicing into the raw line.
 */
export function restorePlaceholders(data: string, workspaceRoot: string, homeDir: string): string {
  const escapedWs = JSON.stringify(workspaceRoot).slice(1, -1)
  const escapedHome = JSON.stringify(homeDir).slice(1, -1)
  return data.split('$SPOOL_WS').join(escapedWs).split('$SPOOL_HOME').join(escapedHome)
}

/** Claude Code names project dirs by the cwd with every non-alphanumeric character mapped to '-'. */
export function claudeProjectDirName(workspaceRoot: string): string {
  return workspaceRoot.replace(/[^a-zA-Z0-9]/g, '-')
}
