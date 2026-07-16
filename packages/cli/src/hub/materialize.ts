import { buildBirthText, type BirthPayload } from './birth.js'

// Resume materialization (claude): turn hub records back into a fresh
// provider-native session file. The original session is never modified —
// a new UUID is minted, every record's sessionId is rewritten, the
// $SPOOL_WS/$SPOOL_HOME placeholders map to the resumer's paths, and
// exactly one clearly-marked Spool birth record is appended. The file is
// written where Claude Code keeps sessions for the target workspace, so
// `claude --resume <uuid>` picks it up natively.

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
  /** Claude Code's project-directory name for the workspace root. */
  projectDirName: string
  fileName: string
}

export function materializeClaudeSession(opts: MaterializeOptions): MaterializedSession {
  const sorted = [...opts.records].sort((a, b) => a.i - b.i)
  const lines: string[] = []
  let lastUuid: string | null = null
  let lastCwd: string | null = null

  for (const record of sorted) {
    const restored = restorePlaceholders(record.data, opts.workspaceRoot, opts.homeDir)
    let parsed: Record<string, unknown>
    try {
      const value = JSON.parse(restored) as unknown
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('record is not an object')
      }
      parsed = value as Record<string, unknown>
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Record ${record.i} is not valid JSON: ${message}`)
    }
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
    projectDirName: claudeProjectDirName(opts.workspaceRoot),
    fileName: `${opts.sessionId}.jsonl`,
  }
}

/**
 * Replace canonicalization placeholders with the resumer's local paths.
 * Tokens live inside JSON string values, so the replacement must be
 * JSON-escaped before splicing into the raw line.
 */
export function restorePlaceholders(
  data: string,
  workspaceRoot: string,
  homeDir: string,
): string {
  const escapedWs = JSON.stringify(workspaceRoot).slice(1, -1)
  const escapedHome = JSON.stringify(homeDir).slice(1, -1)
  return data
    .split('$SPOOL_WS').join(escapedWs)
    .split('$SPOOL_HOME').join(escapedHome)
}

/** Claude Code names project dirs by the cwd with every non-alphanumeric character mapped to '-'. */
export function claudeProjectDirName(workspaceRoot: string): string {
  return workspaceRoot.replace(/[^a-zA-Z0-9]/g, '-')
}
