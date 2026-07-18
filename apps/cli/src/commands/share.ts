import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'

import { getDB, getSessionWithMessages } from '@spool-lab/core'
import { canonicalizeRecord, type SessionProvider } from '@spool-lab/session-kit'
import { Command } from 'commander'

import { HubClient, HubHttpError, type HubFetch, type HubObjectUpload } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { editNote } from '../hub/note-editor.js'
import { buildNotePrefill } from '../hub/note.js'
import { formatRedactSummary, scanRecordsForSecrets } from '../hub/redact-gate.js'
import { UPLOAD_MAX_LINES, chunkUploads, prepareShare } from '../hub/share-pipeline.js'
import { buildWorkspaceCard, detectWorkspaceRoot } from '../hub/workspace.js'
import { expandLocalSessionUuid } from '../local-session-ref.js'

// `spool share [<session-id>][@<n>]` — canonicalize the provider session,
// run the redact gate, collect the note, then the 3-step hub handshake:
// push (learn missing) → objects/batch (upload) → head (commit, get URL).

export interface ShareTarget {
  provider: SessionProvider
  sessionUuid: string
  filePath: string
  cwd: string | null
}

export interface ShareCommandOptions {
  message?: string
  noEdit?: boolean
  yes?: boolean
  /** Path to a .spool document to attach to the share. */
  spoolFile?: string
}

export interface ShareCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  log?: (message: string) => void
  error?: (message: string) => void
  /** Injected in tests; defaults to the core index lookup. */
  resolveTarget?: (sessionUuid: string | undefined, cwd: string) => ShareTarget
  confirm?: (question: string) => Promise<boolean>
  cwd?: string
}

export async function handleShareCommand(
  input: string | undefined,
  options: ShareCommandOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  const cwd = dependencies.cwd ?? process.cwd()

  try {
    const { sessionUuid, position } = parseShareRef(input)
    const resolveTarget = dependencies.resolveTarget ?? resolveTargetFromIndex
    const target = resolveTarget(sessionUuid, cwd)

    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    if (!credentials.token) {
      error('Not logged in. Run `spool login` first.')
      return 1
    }

    const homeDir = dependencies.homeDir ?? homedir()
    const workspaceRoot = detectWorkspaceRoot(target.cwd ?? cwd)
    const card = buildWorkspaceCard(workspaceRoot)

    const prepared = await prepareShare({
      provider: target.provider,
      sessionUuid: target.sessionUuid,
      jsonl: readFileSync(target.filePath, 'utf8'),
      ...(position === undefined ? {} : { position }),
      workspaceRoot,
      homeDir,
    })

    const secrets = scanRecordsForSecrets(prepared.records.map((record) => record.data))
    if (secrets.total > 0) {
      log(formatRedactSummary(secrets))
      if (options.yes !== true) {
        const confirm = dependencies.confirm ?? promptConfirm
        if (!(await confirm('Share anyway? [y/N] '))) {
          error('Share aborted.')
          return 1
        }
      }
    }

    const prefill = buildNotePrefill({ view: prepared.view, card, count: prepared.count })
    const note = editNote(prefill, {
      ...(options.message === undefined ? {} : { message: options.message }),
      ...(options.noEdit === undefined ? {} : { noEdit: options.noEdit }),
    })

    const client = new HubClient({
      hubUrl: credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })

    const spoolFile =
      options.spoolFile === undefined ? null : await readSpoolFileObject(options.spoolFile)

    const head = {
      root: prepared.root,
      count: prepared.count,
      manifest: prepared.manifest,
      sig: null,
      cardJson: card === null ? null : JSON.stringify(card),
      noteMd: note.trim() === '' ? null : note,
      lineageJson: prepared.lineageJson,
      viewOid: prepared.viewOid,
      spoolFileOid: spoolFile === null ? null : spoolFile.oid,
    }

    const { missing } = await client.pushSession(prepared.sid, head)
    const missingSet = new Set(missing)
    const uploads: HubObjectUpload[] = [
      ...prepared.records.map((record) => ({ oid: record.oid, data: record.data })),
      { oid: prepared.viewOid, data: prepared.viewData },
      ...(spoolFile === null ? [] : [spoolFile]),
    ].filter((object) => missingSet.has(object.oid))

    let uploaded = 0
    for (const batch of chunkUploads(uploads)) {
      await client.uploadObjects(batch)
      uploaded += batch.length
      if (uploads.length > UPLOAD_MAX_LINES) {
        log(`Uploaded ${uploaded}/${uploads.length} objects…`)
      }
    }

    const { url } = await client.commitSessionHead(prepared.sid, head)
    log(`Shared ${prepared.count} record(s): ${url}`)
    return 0
  } catch (cause) {
    if (cause instanceof HubHttpError && cause.status === 401) {
      error('Authentication failed. Run `spool login` to update your hub token.')
    } else {
      error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

export const shareCommand = new Command('share')
  .description('Share a session to the Spool hub and get a URL')
  .argument(
    '[session]',
    'Session UUID, optionally with @<n> for a prefix share; defaults to the latest session in the current directory',
  )
  .option('-m, --message <note>', 'Note text (skips the editor)')
  .option('--no-edit', 'Publish the prefilled draft without opening the editor')
  .option('--yes', 'Skip the secret-findings confirmation')
  .option('--spool-file <path>', 'Attach a .spool document to the share')
  .action(
    async (
      session: string | undefined,
      opts: { message?: string; edit?: boolean; yes?: boolean; spoolFile?: string },
    ) => {
      const exitCode = await handleShareCommand(session, {
        ...(opts.message === undefined ? {} : { message: opts.message }),
        // commander maps --no-edit to edit:false.
        ...(opts.edit === false ? { noEdit: true } : {}),
        ...(opts.yes === undefined ? {} : { yes: opts.yes }),
        ...(opts.spoolFile === undefined ? {} : { spoolFile: opts.spoolFile }),
      })
      if (exitCode !== 0) process.exitCode = exitCode
    },
  )

/** Read + canonicalize a .spool document for attachment. Shape-checked
 *  only (version + conversation) — the document is a display artifact,
 *  not wire-critical data. */
async function readSpoolFileObject(path: string): Promise<{ oid: string; data: string }> {
  const raw = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Not a valid .spool file (malformed JSON): ${path}`)
  }
  const doc = parsed as { version?: unknown; conversation?: unknown }
  if (
    (doc.version !== 1 && doc.version !== 2) ||
    typeof doc.conversation !== 'object' ||
    doc.conversation === null
  ) {
    throw new Error(`Not a valid .spool file (unrecognized shape): ${path}`)
  }
  return canonicalizeRecord(raw)
}

function parseShareRef(input: string | undefined): { sessionUuid?: string; position?: number } {
  if (input === undefined) return {}
  const match = input
    .trim()
    .match(/^(?:(?:claude|codex)_)?([0-9a-fA-F-]{8,64})(?:@([1-9][0-9]*))?$/)
  if (!match?.[1]) {
    throw new Error(`Invalid session reference: ${input}. Expected <uuid> or <uuid>@<n>.`)
  }
  return {
    sessionUuid: match[1],
    ...(match[2] === undefined ? {} : { position: Number(match[2]) }),
  }
}

function resolveTargetFromIndex(sessionUuid: string | undefined, cwd: string): ShareTarget {
  const db = getDB(true)
  const uuid =
    sessionUuid === undefined
      ? latestSessionUuidFor(db, cwd)
      : expandLocalSessionUuid(db, sessionUuid)
  const found = getSessionWithMessages(db, uuid)
  if (!found) throw new Error(`Session not found in the local index: ${uuid} (run \`spool sync\`?)`)
  const { session } = found
  if (session.source !== 'claude' && session.source !== 'codex') {
    throw new Error(
      `Sharing ${session.source} sessions is not supported yet (claude and codex only)`,
    )
  }
  if (session.filePath.startsWith('spool:')) {
    throw new Error('This session has no provider file on disk yet')
  }
  return {
    provider: session.source,
    sessionUuid: session.sessionUuid,
    filePath: session.filePath,
    cwd: session.cwd,
  }
}

function latestSessionUuidFor(db: ReturnType<typeof getDB>, cwd: string): string {
  const row = db
    .prepare('SELECT session_uuid FROM sessions WHERE cwd = ? ORDER BY ended_at DESC LIMIT 1')
    .get(cwd) as { session_uuid: string } | undefined
  if (!row) {
    throw new Error(`No indexed sessions for ${cwd}. Pass a session UUID or run \`spool sync\`.`)
  }
  return row.session_uuid
}

async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(question)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}
