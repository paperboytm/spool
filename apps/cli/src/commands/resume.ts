import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { sequenceRoot } from '@spool-lab/session-kit'
import { Command } from 'commander'

import { HubClient, HubHttpError, type HubFetch, type HubRecord } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { materializeSession } from '../hub/materialize.js'
import { resolveSessionRef } from '../hub/ref.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

// `spool resume <url|sid>[<@n>]` — materialize, don't graft (design §3):
// fetch the shared records, verify integrity client-side, write a brand-new
// provider-native session (claude → ~/.claude/projects, codex →
// ~/.codex/sessions), then launch the provider's native FORK entry point
// (`claude --resume --fork-session` / `codex fork` — both open waiting
// for input; no model turn runs). The materialized file is an immutable
// anchor: continued work lands in the forked session, so the anchor keeps
// matching the shared integrity root and every launch branches fresh from
// the share point. `--no-exec` prints the command instead of launching.

const READ_PAGE = 500

export interface ResumeCommandOptions {
  workspace?: string
  exec?: boolean
}

export interface ResumeCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  log?: (message: string) => void
  error?: (message: string) => void
  cwd?: string
  spawn?: typeof spawnSync
  ui?: CliUi
}

export async function handleResumeCommand(
  input: string,
  options: ResumeCommandOptions,
  dependencies: ResumeCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  const ui = dependencies.ui ?? createTextUi(log, error)
  ui.intro('Resume a shared session')

  try {
    const ref = resolveSessionRef(input)
    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    const hubUrl = ref.hubUrl ?? credentials.hubUrl
    const client = new HubClient({
      hubUrl,
      ...(credentials.token === undefined ? {} : { token: credentials.token }),
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })

    const downloading = ui.spinner()
    downloading.start('Downloading shared session records')
    let downloaded: Awaited<ReturnType<typeof downloadAndVerify>>
    try {
      downloaded = await downloadAndVerify(client, ref.sid, ref.position)
      downloading.stop(`Verified ${downloaded.records.length} records`)
    } catch (cause) {
      downloading.error('Could not download and verify the shared session')
      throw cause
    }
    const { meta, records, wanted } = downloaded

    const workspaceRoot = resolveWorkspaceRoot(
      options.workspace ?? dependencies.cwd ?? process.cwd(),
    )
    const homeDir = dependencies.homeDir ?? homedir()
    const sessionId = crypto.randomUUID()

    const materialized = materializeSession(ref.provider, {
      records,
      sessionId,
      workspaceRoot,
      homeDir,
      birth: {
        source: {
          sid: ref.sid,
          position: wanted,
          url: `${hubUrl}/session/${ref.sid}`,
        },
      },
      cardJson: meta.cardJson,
    })

    const sessionDir = join(homeDir, ...materialized.dirSegments)
    mkdirSync(sessionDir, { recursive: true })
    const filePath = join(sessionDir, materialized.fileName)
    if (existsSync(filePath)) throw new Error(`Refusing to overwrite ${filePath}`)
    writeFileSync(filePath, materialized.lines.join('\n') + '\n', 'utf8')

    ui.success(`Materialized a new ${ref.provider} session ${sessionId}`)
    if (meta.cardJson) {
      ui.note(meta.cardJson, 'Author’s last observed workspace state')
    }
    // Always print the command — it stays in scrollback, and re-running
    // it forks another fresh branch off the materialized anchor.
    ui.note(`cd ${workspaceRoot} && ${materialized.resumeArgv.join(' ')}`, 'Native resume command')

    if (options.exec === false) {
      ui.outro('Session materialized. Run the command above when ready.')
      return 0
    }

    ui.outro(`Launching ${ref.provider === 'claude' ? 'Claude Code' : 'Codex CLI'}…`)
    const spawn = dependencies.spawn ?? spawnSync
    const [command, ...args] = materialized.resumeArgv as [string, ...string[]]
    const result = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
    })
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        ui.error(
          `${command} CLI not found on PATH — the session is materialized; run the command above manually.`,
        )
        return 1
      }
      throw result.error
    }
    return result.status === 0 ? 0 : 1
  } catch (cause) {
    if (cause instanceof HubHttpError) {
      ui.error(friendlyHubError(cause, input))
    } else {
      ui.error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

export const resumeCommand = new Command('resume')
  .description('Materialize a shared session locally and resume it natively')
  .argument('<sid|url>', 'Shared session ID or URL, optionally @<n>')
  .option('--workspace <dir>', 'Workspace root to resume in (default: current directory)')
  .option('--no-exec', 'Print the native resume command instead of launching it')
  .action(async (input: string, opts: { workspace?: string; exec: boolean }) => {
    const exitCode = await handleResumeCommand(
      input,
      {
        ...(opts.workspace === undefined ? {} : { workspace: opts.workspace }),
        exec: opts.exec,
      },
      { ui: createClackUi() },
    )
    if (exitCode !== 0) process.exitCode = exitCode
  })

/**
 * Claude Code names project dirs after the REAL cwd — on macOS `/tmp/x`
 * records as `/private/tmp/x`. Materializing under the unresolved path
 * puts the session where `claude --resume` never looks, so resolve
 * symlinks first. A workspace that doesn't exist yet (the agent may
 * clone it after resume) keeps the resolved-but-unverified path.
 */
function resolveWorkspaceRoot(input: string): string {
  const absolute = resolve(input)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

async function downloadAndVerify(client: HubClient, sid: string, position?: number) {
  const meta = await client.getSession(sid)
  const wanted = Math.min(position ?? meta.count, meta.count)
  if (wanted < 1) throw new Error('Nothing to resume: the shared session is empty.')
  const records = await fetchRecords(client, sid, wanted)
  await verifyRecords(records, wanted === meta.count ? meta.root : null)
  return { meta, records, wanted }
}

async function fetchRecords(client: HubClient, sid: string, wanted: number): Promise<HubRecord[]> {
  const records: HubRecord[] = []
  let from = 0
  while (records.length < wanted) {
    const to = Math.min(from + READ_PAGE, wanted)
    let progressed = false
    for await (const record of client.getSessionRecords(sid, { from, to })) {
      records.push(record)
      progressed = true
    }
    // The server may return fewer lines than requested (byte cap); continue
    // from the last index we actually received.
    if (!progressed) throw new Error(`Hub returned no records for range ${from}..${to}`)
    from = (records[records.length - 1] as HubRecord).i + 1
  }
  return records
}

async function verifyRecords(
  records: readonly HubRecord[],
  expectedRoot: string | null,
): Promise<void> {
  for (const record of records) {
    const digest = createHash('sha256').update(record.data, 'utf8').digest('hex')
    if (digest !== record.oid) {
      throw new Error(`Integrity check failed: record ${record.i} does not match its oid`)
    }
  }
  if (expectedRoot !== null) {
    const root = await sequenceRoot(records.map((record) => record.oid))
    if (root !== expectedRoot) {
      throw new Error('Integrity check failed: records do not fold to the published root')
    }
  }
}

function friendlyHubError(error: HubHttpError, input: string): string {
  if (error.status === 404) return `Session not found: ${input}`
  if (error.status === 410) return 'This session was withdrawn by its author.'
  return `Hub returned HTTP ${error.status}: ${error.bodyMessage}`
}

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}
