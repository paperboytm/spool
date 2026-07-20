import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'

import {
  formatCliCommand,
  getDB,
  getSessionWithMessages,
  serializeIndexedSession,
} from '@spool-lab/core'
import {
  canonicalizeRecord,
  isDiscoverySessionProvider,
  isResumableSessionProvider,
  parseSessionText,
  SESSION_PROVIDERS,
  type SessionProvider,
} from '@spool-lab/session-kit'
import { Command } from 'commander'

import { copyTextToClipboard } from '../clipboard.js'
import { buildSessionSummaryPrompt } from '../hub/agent-summary-prompt.js'
import { HubClient, HubHttpError, type HubFetch } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import {
  detectLocalSummaryAgents,
  runLocalSummaryAgent,
  type LocalSummaryAgent,
} from '../hub/local-summary-agent.js'
import { publishPreparedShare } from '../hub/publish.js'
import { formatRedactSummary, scanRecordsForSecrets } from '../hub/redact-gate.js'
import { prepareShare, type PreparedShare } from '../hub/share-pipeline.js'
import { buildWorkspaceCard, detectWorkspaceRoot } from '../hub/workspace.js'
import { expandLocalSessionUuid } from '../local-session-ref.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

// `spool share [<session-id>][@<n>]` publishes supported Sessions first. Once the
// URL is live, an interactive terminal can offer one of the user's installed
// local Agent CLIs to generate a Markdown Summary and advance the same head.

const SHARE_REF_PATTERN = new RegExp(
  `^(?:(?:${SESSION_PROVIDERS.join('|')})_)?([0-9A-Za-z_-]{8,128})(?:@([1-9][0-9]*))?$`,
)

export interface ShareTarget {
  provider: SessionProvider
  sessionUuid: string
  filePath: string
  cwd: string | null
  /** Portable JSONL for indexed sources without native provider records. */
  jsonl?: string
}

export interface ShareCommandOptions {
  /** Advanced/manual bypass. The recommended flow uses a detected local Agent. */
  summary?: string
  /** Skip the post-upload local Agent offer. */
  agentSummary?: boolean
  yes?: boolean
  /** An enclosing flow or non-interactive caller acknowledged the resulting visibility. */
  visibilityConfirmed?: boolean
  /** An enclosing UI already displayed the exact Public/Link-only outcome. */
  visibilityDisclosed?: boolean
  /** Path to a .spool document to attach to the share. */
  spoolFile?: string
}

export interface ShareCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  log?: (message: string) => void
  error?: (message: string) => void
  ui?: CliUi
  /** Injected in tests; defaults to the core index lookup. */
  resolveTarget?: (sessionUuid: string | undefined, cwd: string) => ShareTarget
  confirm?: (question: string) => Promise<boolean>
  detectSummaryAgents?: () => Promise<LocalSummaryAgent[]>
  generateSummary?: (agent: LocalSummaryAgent, prompt: string) => Promise<string>
  buildSummaryPrompt?: (target: ShareTarget, prepared: PreparedShare) => string
  /** Best-effort clipboard writer; injected in tests. */
  copyToClipboard?: (text: string) => boolean | Promise<boolean>
  cwd?: string
}

export async function handleShareCommand(
  input: string | undefined,
  options: ShareCommandOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  const ui = dependencies.ui ?? createTextUi(log, error)
  const cwd = dependencies.cwd ?? process.cwd()
  ui.intro('Share a session')

  try {
    const { sessionUuid, position } = parseShareRef(input)
    const resolveTarget = dependencies.resolveTarget ?? resolveTargetFromIndex
    const target = resolveTarget(sessionUuid, cwd)
    const publicByDefault = isDiscoverySessionProvider(target.provider)

    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    if (!credentials.token) {
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      return 1
    }

    if (options.summary !== undefined && options.summary.trim() === '') {
      ui.error('`--summary` cannot be empty. Omit it to use the local Agent flow.')
      return 1
    }

    const homeDir = dependencies.homeDir ?? homedir()
    const workspaceRoot = detectWorkspaceRoot(target.cwd ?? cwd)
    const card = buildWorkspaceCard(workspaceRoot)
    const preparation = ui.spinner()
    preparation.start('Preparing local session records')
    let prepared: PreparedShare
    try {
      prepared = await prepareShare({
        provider: target.provider,
        sessionUuid: target.sessionUuid,
        jsonl: target.jsonl ?? readFileSync(target.filePath, 'utf8'),
        ...(position === undefined ? {} : { position }),
        workspaceRoot,
        homeDir,
      })
      preparation.stop(`Prepared ${prepared.count} records`)
    } catch (cause) {
      preparation.error('Could not prepare the session')
      throw cause
    }

    const secrets = scanRecordsForSecrets(prepared.records.map((record) => record.data))
    if (secrets.total > 0) {
      ui.warn(formatRedactSummary(secrets))
      if (options.yes !== true) {
        const approved = dependencies.confirm
          ? await dependencies.confirm('Share despite the secret findings?')
          : await ui.confirm('Share despite the secret findings?', true)
        if (approved !== true) {
          if (approved === null && !ui.interactive) {
            ui.error('Cannot confirm secret findings without a TTY. Re-run with `--yes`.')
          } else {
            ui.cancel('Share cancelled before upload.')
          }
          return 1
        }
      }
    }

    const visibilityConfirmation = publicByDefault
      ? 'Publish this Session as Public? It can appear in Explore and search.'
      : 'Share this Session as Link-only? Anyone with the URL can read it.'
    let visibilityDisclosed = options.visibilityDisclosed === true
    if (options.yes !== true && options.visibilityConfirmed !== true) {
      if (!ui.interactive) {
        ui.error(
          'Cannot confirm the resulting visibility without a TTY. Re-run with `--visibility-confirmed`.',
        )
        return 1
      }
      const approved = await ui.confirm(visibilityConfirmation, true)
      if (approved !== true) {
        if (approved === null) ui.cancel('Share cancelled before upload.')
        else ui.outro('Session not shared.')
        return 1
      }
      visibilityDisclosed = true
    }
    if (!visibilityDisclosed) {
      ui.info(
        publicByDefault
          ? 'This Session will be Public and can appear in Explore and search.'
          : 'This Session will be Link-only; anyone with the URL can read it.',
      )
    }

    const client = new HubClient({
      hubUrl: credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })
    const spoolFile =
      options.spoolFile === undefined ? null : await readSpoolFileObject(options.spoolFile)
    const initialSummary = await existingSummary(client, prepared.sid)

    const upload = ui.spinner()
    upload.start('Uploading session')
    let url: string
    try {
      const published = await publishPreparedShare(client, prepared, {
        card,
        summary: initialSummary,
        spoolFile,
        onUploadProgress: (uploaded, total) =>
          upload.message(`Uploading session objects ${uploaded}/${total}`),
      })
      url = published.url
      upload.stop(`Uploaded ${prepared.count} records`)
    } catch (cause) {
      upload.error('Session upload failed')
      throw cause
    }
    await announceShareComplete(
      ui,
      url,
      publicByDefault,
      dependencies.copyToClipboard ?? copyTextToClipboard,
    )

    if (options.summary !== undefined) {
      const summaryUpload = ui.spinner()
      summaryUpload.start('Uploading the provided Markdown Summary')
      try {
        await publishPreparedShare(client, prepared, {
          card,
          summary: options.summary,
          spoolFile,
          onUploadProgress: (uploaded, total) =>
            summaryUpload.message(`Uploading Summary objects ${uploaded}/${total}`),
        })
        summaryUpload.stop('Provided Summary uploaded')
        ui.outro('Summary uploaded.')
        return 0
      } catch (cause) {
        summaryUpload.error('Could not upload the provided Summary')
        ui.warn(`The session is already shared at ${url}. Its previous Summary is unchanged.`)
        ui.error(cause instanceof Error ? cause.message : String(cause))
        return 1
      }
    }
    if (options.agentSummary === false || !ui.interactive) {
      if (initialSummary) ui.info('Existing Summary preserved.')
      if (ui.interactive) ui.outro('No new Summary added.')
      return 0
    }

    const detection = ui.spinner()
    detection.start('Looking for local Agents')
    let agents: LocalSummaryAgent[]
    try {
      agents = await (dependencies.detectSummaryAgents ?? detectLocalSummaryAgents)()
    } catch (cause) {
      detection.error('Could not detect local Agents')
      ui.warn(`The session is already shared at ${url}.`)
      ui.info(cause instanceof Error ? cause.message : String(cause))
      return 0
    }
    if (agents.length === 0) {
      detection.stop('No supported local Agent found')
      ui.info('Install Claude Code or Codex CLI to generate a Summary after sharing.')
      ui.outro('No new Summary added.')
      return 0
    }
    detection.stop(`Found ${agents.map((agent) => agent.name).join(' and ')}`)
    ui.info(
      'Generation uses the selected Agent’s configured model and provider, which may incur provider usage.',
    )

    const wantsSummary = await ui.confirm(
      agents.length === 1
        ? `Generate a Summary with ${agents[0]!.name}?`
        : 'Generate a Summary with a local Agent?',
      true,
    )
    if (wantsSummary !== true) {
      if (wantsSummary === null) ui.cancel('Session shared; Summary generation cancelled.')
      else ui.outro('No new Summary added.')
      return 0
    }

    const agent = await chooseSummaryAgent(ui, agents, target.provider)
    if (!agent) {
      ui.cancel('Session shared; Summary generation cancelled.')
      return 0
    }

    const summarize =
      dependencies.generateSummary ??
      ((selected, value) =>
        runLocalSummaryAgent(selected, value, { env: { ...process.env, ...dependencies.env } }))
    const generation = ui.spinner()
    generation.start(`${agent.name} is generating the Summary`)
    try {
      const prompt =
        dependencies.buildSummaryPrompt?.(target, prepared) ??
        buildPreparedSummaryPrompt(target, prepared)
      const summary = (await summarize(agent, prompt)).trim()
      if (!summary) throw new Error(`${agent.name} returned an empty Summary.`)
      generation.message('Uploading generated Summary')
      await publishPreparedShare(client, prepared, {
        card,
        summary,
        spoolFile,
        onUploadProgress: (uploaded, total) =>
          generation.message(`Uploading Summary objects ${uploaded}/${total}`),
      })
      generation.stop(`Summary generated by ${agent.name} and uploaded`)
      ui.outro('Summary uploaded.')
      return 0
    } catch (cause) {
      generation.error('Could not generate or upload the Summary')
      ui.warn(`The session is already shared at ${url}. Its previous Summary is unchanged.`)
      ui.error(cause instanceof Error ? cause.message : String(cause))
      return 1
    }
  } catch (cause) {
    if (cause instanceof HubHttpError && cause.status === 401) {
      ui.error(
        `Authentication failed. Run \`${formatCliCommand('login')}\` to update your hub token.`,
      )
    } else {
      ui.error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

async function announceShareComplete(
  ui: CliUi,
  url: string,
  publicByDefault: boolean,
  copyToClipboard: (text: string) => boolean | Promise<boolean>,
): Promise<void> {
  ui.note(url, publicByDefault ? 'Public Session URL' : 'Link-only URL')
  let copied = false
  if (ui.interactive) {
    try {
      copied = await copyToClipboard(url)
    } catch {
      // Clipboard access is a convenience; a live share must still succeed.
    }
  }
  const result = publicByDefault ? 'Session published.' : 'Session shared as Link-only.'
  ui.success(copied ? `${result} Link copied to clipboard.` : result)
  if (ui.interactive && !copied) {
    ui.info('Could not copy automatically. Copy the Session URL above to share it.')
  }
  if (publicByDefault) {
    ui.info('This Session can appear in Explore and search. The source Session stays unchanged.')
  } else {
    ui.info('This provider is not yet supported in Explore, so the Session remains Link-only.')
  }
}

export const shareCommand = new Command('share')
  .description('Share a session, then optionally generate its Summary with a local Agent')
  .argument(
    '[session]',
    'Session UUID, optionally with @<n> for a prefix share; defaults to the latest session in the current directory',
  )
  .option(
    '-s, --summary <markdown>',
    'Provide Summary Markdown directly (advanced; local Agent generation is recommended)',
  )
  .option('--no-agent-summary', 'Do not offer to generate a Summary with a local Agent')
  .option('--visibility-confirmed', 'Acknowledge visibility when running without a TTY')
  .option('--yes', 'Skip all confirmations, including secret findings')
  .option('--spool-file <path>', 'Attach a .spool document to the share')
  .action(
    async (
      session: string | undefined,
      opts: {
        summary?: string
        agentSummary: boolean
        visibilityConfirmed?: boolean
        yes?: boolean
        spoolFile?: string
      },
    ) => {
      const exitCode = await handleShareCommand(
        session,
        {
          ...(opts.summary === undefined ? {} : { summary: opts.summary }),
          agentSummary: opts.agentSummary,
          ...(opts.visibilityConfirmed === undefined
            ? {}
            : { visibilityConfirmed: opts.visibilityConfirmed }),
          ...(opts.yes === undefined ? {} : { yes: opts.yes }),
          ...(opts.spoolFile === undefined ? {} : { spoolFile: opts.spoolFile }),
        },
        { ui: createClackUi() },
      )
      if (exitCode !== 0) process.exitCode = exitCode
    },
  )

async function chooseSummaryAgent(
  ui: CliUi,
  agents: LocalSummaryAgent[],
  preferred: SessionProvider,
): Promise<LocalSummaryAgent | null> {
  if (agents.length === 1) return agents[0] ?? null
  const selected = await ui.select({
    message: 'Which local Agent should generate the Summary?',
    choices: agents.map((agent) => ({
      value: agent.id,
      label: agent.name,
      ...(agent.id === preferred ? { hint: 'same as this session' } : {}),
    })),
    initialValue: agents.some((agent) => agent.id === preferred)
      ? preferred
      : (agents[0] as LocalSummaryAgent).id,
  })
  return agents.find((agent) => agent.id === selected) ?? null
}

function buildPreparedSummaryPrompt(target: ShareTarget, prepared: PreparedShare): string {
  const raw = prepared.records.map((record) => record.data).join('\n')
  const parsed = parseSessionText(target.provider, raw, target.filePath)
  if (parsed.kind !== 'parsed') {
    throw new Error('Could not extract the shared conversation for Summary generation.')
  }
  return buildSessionSummaryPrompt(parsed.session, parsed.session.messages).prompt
}

async function existingSummary(client: HubClient, sid: string): Promise<string | null> {
  try {
    return (await client.getSession(sid)).summaryMd
  } catch (cause) {
    if (cause instanceof HubHttpError && (cause.status === 404 || cause.status === 410)) return null
    throw cause
  }
}

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
  const match = input.trim().match(SHARE_REF_PATTERN)
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
  if (!found) {
    throw new Error(
      `Session not found in the local index: ${uuid} (run \`${formatCliCommand('sync')}\`?)`,
    )
  }
  const { session } = found
  if (session.filePath.startsWith('spool:')) {
    throw new Error('This session has no provider file on disk yet')
  }
  return {
    provider: session.source,
    sessionUuid: session.sessionUuid,
    filePath: session.filePath,
    cwd: session.cwd,
    ...(isResumableSessionProvider(session.source)
      ? {}
      : { jsonl: serializeIndexedSession(session, found.messages) }),
  }
}

export function latestSessionUuidFor(db: ReturnType<typeof getDB>, cwd: string): string {
  const exact = db
    .prepare('SELECT session_uuid FROM sessions WHERE cwd = ? ORDER BY ended_at DESC LIMIT 1')
    .get(cwd) as { session_uuid: string } | undefined
  if (exact) return exact.session_uuid

  // Provider records may preserve a symlinked spelling of the workspace while
  // process.cwd() returns its real path (notably macOS /tmp → /private/tmp).
  // Compare real paths only as a fallback so the common indexed lookup stays
  // cheap and a session can still be shared from the workspace it belongs to.
  const canonicalCwd = canonicalExistingPath(cwd)
  const candidates = db
    .prepare('SELECT session_uuid, cwd FROM sessions WHERE cwd IS NOT NULL ORDER BY ended_at DESC')
    .all() as Array<{ session_uuid: string; cwd: string }>
  const matching = candidates.find(
    (candidate) => canonicalExistingPath(candidate.cwd) === canonicalCwd,
  )
  if (matching) return matching.session_uuid

  throw new Error(
    `No indexed sessions for ${cwd}. Pass a session UUID or run \`${formatCliCommand('sync')}\`.`,
  )
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}
