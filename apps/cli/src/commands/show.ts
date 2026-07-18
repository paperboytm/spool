import { readFileSync } from 'node:fs'

import { getDB, getSessionWithMessages } from '@spool-lab/core'
import {
  composeSessionDiff,
  deriveView,
  extractEditEvents,
  splitRecords,
  type SessionDiff,
  type SessionProvider,
  type SessionViewV1,
} from '@spool-lab/session-kit'
import { Command } from 'commander'

import { HubClient, HubHttpError, type HubFetch } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { fetchRecordsByIndices, fetchRecordsExact } from '../hub/records.js'
import { resolveSessionRef, type ResolvedSessionRef } from '../hub/ref.js'
import { expandLocalSessionUuid } from '../local-session-ref.js'

// `spool show <uuid|sid|url>[@r<n>]` — the design's command-table rule:
// the CLI is the primary surface, the web page its projection. Default is
// the first-screen summary (hub refs) or the full transcript (local
// uuids, unchanged legacy output); `--log` prints the timeline, `--diff`
// the composed net change, `@r<n>` drops onto one record.

export interface ShowCommandOptions {
  json?: boolean
  log?: boolean
  diff?: boolean
}

export interface ShowCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  log?: (message: string) => void
  error?: (message: string) => void
  /** Injected in tests; defaults to the core index lookup. */
  resolveLocal?: (uuid: string) => LocalShowTarget | null
}

export interface LocalShowTarget {
  provider: SessionProvider | null
  filePath: string | null
  /** Session cwd — normalizes edit-event paths to workspace-relative. */
  workspaceRoot: string | null
  print: (json: boolean) => void
}

export interface ParsedShowRef {
  kind: 'hub' | 'local'
  ref?: ResolvedSessionRef
  uuid?: string
  recordIndex?: number
}

export async function handleShowCommand(
  input: string,
  options: ShowCommandOptions,
  dependencies: ShowCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error

  try {
    const parsed = parseShowRef(input)
    if (parsed.kind === 'hub') {
      return await showHub(parsed, options, dependencies, log)
    }
    return showLocal(parsed, options, dependencies, log, error)
  } catch (cause) {
    if (cause instanceof HubHttpError) {
      if (cause.status === 404) error(`Session not found: ${input}`)
      else if (cause.status === 410) error('This session was withdrawn by its author.')
      else error(`Hub returned HTTP ${cause.status}: ${cause.bodyMessage}`)
    } else {
      error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

// ── Hub refs ────────────────────────────────────────────────────────────

async function showHub(
  parsed: ParsedShowRef,
  options: ShowCommandOptions,
  dependencies: ShowCommandDependencies,
  log: (message: string) => void,
): Promise<0 | 1> {
  const ref = parsed.ref as ResolvedSessionRef
  const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
  const client = new HubClient({
    hubUrl: ref.hubUrl ?? credentials.hubUrl,
    ...(credentials.token === undefined ? {} : { token: credentials.token }),
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  })

  const meta = await client.getSession(ref.sid)

  if (parsed.recordIndex !== undefined) {
    if (parsed.recordIndex >= meta.count) {
      throw new Error(
        `Record ${parsed.recordIndex} is outside the shared range (0..${meta.count - 1})`,
      )
    }
    const records = await fetchRecordsExact(
      client,
      ref.sid,
      parsed.recordIndex,
      parsed.recordIndex + 1,
    )
    const record = records[0]
    if (!record) throw new Error(`Record ${parsed.recordIndex} could not be fetched`)
    log(prettyRecord(record.data))
    return 0
  }

  const view = await client.getSessionView<SessionViewV1>(ref.sid)

  if (options.json === true) {
    log(JSON.stringify({ meta, view }, null, 2))
    return 0
  }

  if (options.diff === true) {
    const diff = await composeHubDiff(client, ref.sid, ref.provider, view)
    printDiff(diff, log)
    return 0
  }

  if (options.log === true) {
    printTimeline(view, log)
    return 0
  }

  // Default: the first screen (design §5) as text.
  const author = meta.author.handle
    ? `@${meta.author.handle}`
    : (meta.author.displayName ?? 'unknown')
  log(`Session: ${meta.sid}`)
  log(`Author:  ${author} · ${meta.count} records`)
  if (meta.summaryMd) {
    log('')
    log(meta.summaryMd.trim())
  } else if (view.firstPrompt || view.lastReply) {
    log('')
    if (view.firstPrompt) log(`Intent:  ${firstLine(view.firstPrompt)}`)
    if (view.lastReply) log(`Outcome: ${firstLine(view.lastReply)}`)
  }
  if (view.files.length > 0) {
    log('')
    log(`Files (${view.diffstat.files}) +${view.diffstat.adds} -${view.diffstat.dels}:`)
    for (const file of view.files.slice(0, 12)) {
      log(`  ${file.path}  +${file.adds} -${file.dels}`)
    }
    if (view.files.length > 12) log(`  … ${view.files.length - 12} more`)
  }
  if (meta.cardJson) {
    const card = safeParse(meta.cardJson) as { branch?: string; head?: string } | null
    if (card?.head) log(`\nWorkspace: ${card.branch ?? '(detached)'} @ ${card.head.slice(0, 7)}`)
  }
  log('')
  log(`Resume:  spool resume ${meta.sid}`)
  return 0
}

async function composeHubDiff(
  client: HubClient,
  sid: string,
  provider: SessionProvider,
  view: SessionViewV1,
): Promise<SessionDiff> {
  const indices = [...new Set(view.files.flatMap((file) => file.events))].sort((a, b) => a - b)
  const records = await fetchRecordsByIndices(client, sid, indices)
  const events = extractEditEvents(
    records.map((record) => ({ i: record.i, data: record.data })),
    { provider },
  )
  return composeSessionDiff(events)
}

// ── Local uuids ─────────────────────────────────────────────────────────

function showLocal(
  parsed: ParsedShowRef,
  options: ShowCommandOptions,
  dependencies: ShowCommandDependencies,
  log: (message: string) => void,
  error: (message: string) => void,
): 0 | 1 {
  const uuid = parsed.uuid as string
  const resolveLocal = dependencies.resolveLocal ?? resolveLocalFromIndex
  const target = resolveLocal(uuid)
  if (!target) {
    error(`Session not found: ${uuid}`)
    return 1
  }

  const needsRecords =
    options.diff === true || options.log === true || parsed.recordIndex !== undefined
  if (!needsRecords) {
    target.print(options.json === true)
    return 0
  }

  if (!target.filePath || !target.provider) {
    error('This session has no provider file on disk — --log/--diff/@r need the raw records.')
    return 1
  }
  const lines = splitRecords(readFileSync(target.filePath, 'utf8'))

  if (parsed.recordIndex !== undefined) {
    const line = lines[parsed.recordIndex]
    if (line === undefined) {
      error(`Record ${parsed.recordIndex} is outside this session (0..${lines.length - 1})`)
      return 1
    }
    log(prettyRecord(line))
    return 0
  }

  const recordsOptions = {
    provider: target.provider,
    ...(target.workspaceRoot === null ? {} : { workspaceRoot: target.workspaceRoot }),
  }

  if (options.diff === true) {
    const events = extractEditEvents(lines, recordsOptions)
    printDiff(composeSessionDiff(events), log)
    return 0
  }

  printTimeline(deriveView(lines, recordsOptions), log)
  return 0
}

function resolveLocalFromIndex(uuid: string): LocalShowTarget | null {
  const db = getDB(true)
  const result = getSessionWithMessages(db, expandLocalSessionUuid(db, uuid))
  if (!result) return null
  const { session, messages } = result
  const provider = session.source === 'claude' || session.source === 'codex' ? session.source : null
  return {
    provider,
    filePath: session.filePath.startsWith('spool:') ? null : session.filePath,
    workspaceRoot: session.cwd,
    // Legacy transcript output — byte-compatible with the previous
    // `spool show <uuid>` so scripts and tests keep working.
    print: (json: boolean) => {
      if (json) {
        console.log(JSON.stringify({ session, messages }, null, 2))
        return
      }

      console.log(`Session: ${session.title ?? '(no title)'}`)
      console.log(`Source:  ${session.source}`)
      console.log(`Project: ${session.projectDisplayPath}`)
      console.log(`Date:    ${formatDate(session.startedAt)}`)
      console.log(`UUID:    ${session.sessionUuid}`)
      console.log(`Messages: ${session.messageCount}`)
      console.log('')
      console.log('─'.repeat(60))

      for (const msg of messages) {
        const role = msg.role.toUpperCase().padEnd(9)
        console.log(`\n[${role}] ${formatDate(msg.timestamp)}`)
        if (msg.toolNames.length > 0) {
          console.log(`Tools: ${msg.toolNames.join(', ')}`)
        }
        console.log(msg.contentText || '(empty)')
      }
    },
  }
}

// ── Shared printers ─────────────────────────────────────────────────────

function printTimeline(view: SessionViewV1, log: (message: string) => void): void {
  for (const entry of view.index) {
    const kind = entry.kind.padEnd(9)
    const detail = entry.file ?? entry.tool ?? ''
    const excerpt = entry.excerpt ? firstLine(entry.excerpt) : ''
    log(
      `#${String(entry.i).padStart(4)}  ${kind} ${[detail, excerpt].filter(Boolean).join('  ')}`.trimEnd(),
    )
  }
}

function printDiff(diff: SessionDiff, log: (message: string) => void): void {
  if (diff.files.length === 0) {
    log('No file changes in this session.')
    return
  }
  log(`${diff.diffstat.files} file(s) +${diff.diffstat.adds} -${diff.diffstat.dels}`)
  for (const file of diff.files) {
    log('')
    log(`── ${file.path}  +${file.adds} -${file.dels}`)
    for (const hunk of file.hunks) {
      log(
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@  records ${hunk.recordIndices.map((index) => `#${index}`).join(' ')}`,
      )
      for (const line of hunk.lines) {
        const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
        log(`${sign}${line.text}`)
      }
    }
  }
}

function prettyRecord(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2)
  } catch {
    return data
  }
}

function firstLine(value: string): string {
  const line = value.split('\n', 1)[0] ?? ''
  return line.length > 160 ? `${line.slice(0, 160)}…` : line
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/** `<uuid|sid|url>` with an optional `@r<n>` record anchor. */
export function parseShowRef(input: string): ParsedShowRef {
  const trimmed = input.trim()
  const anchor = trimmed.match(/@r(\d{1,7})$/)
  const base = anchor ? trimmed.slice(0, -anchor[0].length) : trimmed
  const recordIndex = anchor ? Number(anchor[1]) : undefined

  try {
    const ref = resolveSessionRef(base)
    return { kind: 'hub', ref, ...(recordIndex === undefined ? {} : { recordIndex }) }
  } catch {
    return { kind: 'local', uuid: base, ...(recordIndex === undefined ? {} : { recordIndex }) }
  }
}

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

export const showCommand = new Command('show')
  .description(
    'Show a session: transcript/summary by default, --log for the timeline, --diff for the net change',
  )
  .argument(
    '<session>',
    'Local UUID, hub sid, or share URL — optionally with @r<n> to land on a record',
  )
  .option('--json', 'Output as JSON')
  .option('--log', 'Print the record timeline')
  .option('--diff', 'Print the composed net diff')
  .action(async (session: string, opts: { json?: boolean; log?: boolean; diff?: boolean }) => {
    const exitCode = await handleShowCommand(session, opts)
    if (exitCode !== 0) process.exitCode = exitCode
  })
