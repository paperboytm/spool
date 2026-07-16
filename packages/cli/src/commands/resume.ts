import { Command } from 'commander'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sequenceRoot } from '@spool-lab/session-kit'

import { HubClient, HubHttpError, type HubFetch, type HubRecord } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { materializeClaudeSession } from '../hub/materialize.js'
import { resolveSessionRef } from '../hub/ref.js'

// `spool resume <url|sid>[@<n>]` — materialize, don't graft (design §3):
// fetch the shared records, verify integrity client-side, write a brand-new
// provider-native session under ~/.claude/projects, then hand off to the
// native `claude --resume`. Nothing is executed on the user's behalf unless
// they pass --exec.

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
}

export async function handleResumeCommand(
  input: string,
  options: ResumeCommandOptions,
  dependencies: ResumeCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error

  try {
    const ref = resolveSessionRef(input)
    if (!ref.sid.startsWith('claude_')) {
      error('Only claude sessions can be resumed in this version (codex is a follow-up).')
      return 1
    }

    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    const hubUrl = ref.hubUrl ?? credentials.hubUrl
    const client = new HubClient({
      hubUrl,
      ...(credentials.token === undefined ? {} : { token: credentials.token }),
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })

    const meta = await client.getSession(ref.sid)
    const wanted = Math.min(ref.position ?? meta.count, meta.count)
    if (wanted < 1) {
      error('Nothing to resume: the shared session is empty.')
      return 1
    }

    const records = await fetchRecords(client, ref.sid, wanted)
    await verifyRecords(records, wanted === meta.count ? meta.root : null)

    const workspaceRoot = resolve(options.workspace ?? dependencies.cwd ?? process.cwd())
    const homeDir = dependencies.homeDir ?? homedir()
    const sessionId = crypto.randomUUID()

    const materialized = materializeClaudeSession({
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

    const projectDir = join(homeDir, '.claude', 'projects', materialized.projectDirName)
    mkdirSync(projectDir, { recursive: true })
    const filePath = join(projectDir, materialized.fileName)
    if (existsSync(filePath)) throw new Error(`Refusing to overwrite ${filePath}`)
    writeFileSync(filePath, materialized.lines.join('\n') + '\n', 'utf8')

    log(`Materialized ${records.length} record(s) as a new claude session ${sessionId}.`)
    if (meta.cardJson) {
      log(`Workspace card (author's last observed repo state): ${meta.cardJson}`)
    }
    log('')
    log('Continue with:')
    log(`  cd ${workspaceRoot} && claude --resume ${sessionId}`)

    if (options.exec === true) {
      const spawn = dependencies.spawn ?? spawnSync
      const result = spawn('claude', ['--resume', sessionId], {
        cwd: workspaceRoot,
        stdio: 'inherit',
      })
      if (result.error) throw result.error
      return result.status === 0 ? 0 : 1
    }
    return 0
  } catch (cause) {
    if (cause instanceof HubHttpError) {
      error(friendlyHubError(cause, input))
    } else {
      error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

export const resumeCommand = new Command('resume')
  .description('Materialize a shared session locally and resume it natively')
  .argument('<sid|url>', 'Shared session ID or URL, optionally @<n>')
  .option('--workspace <dir>', 'Workspace root to resume in (default: current directory)')
  .option('--exec', 'Launch `claude --resume` after materializing')
  .action(async (input: string, opts: { workspace?: string; exec?: boolean }) => {
    const exitCode = await handleResumeCommand(input, {
      ...(opts.workspace === undefined ? {} : { workspace: opts.workspace }),
      ...(opts.exec === undefined ? {} : { exec: opts.exec }),
    })
    if (exitCode !== 0) process.exitCode = exitCode
  })

async function fetchRecords(
  client: HubClient,
  sid: string,
  wanted: number,
): Promise<HubRecord[]> {
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

async function verifyRecords(records: readonly HubRecord[], expectedRoot: string | null): Promise<void> {
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
