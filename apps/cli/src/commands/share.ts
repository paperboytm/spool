import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'

import {
  formatCliInstallHint,
  formatCliCommand,
  getDB,
  getSessionWithMessages,
  resolveSessionProjectIdentity,
  serializeIndexedSession,
  type ProjectIdentity,
} from '@spool-lab/core'
import {
  canonicalizeRecord,
  isDiscoverySessionProvider,
  isResumableSessionProvider,
  parseSummaryFrontMatter,
  parseSessionText,
  sessionRecordData,
  SESSION_PROVIDERS,
  type SessionProvider,
} from '@spool-lab/session-kit'
import { Command } from 'commander'

import { copyTextToClipboard } from '../clipboard.js'
import { buildSessionSummaryPrompt } from '../hub/agent-summary-prompt.js'
import {
  HubClient,
  HubHttpError,
  type HubFetch,
  type HubSessionMeta,
  type HubTeam,
} from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import {
  detectLocalSummaryAgents,
  runLocalSummaryAgent,
  type LocalSummaryAgent,
} from '../hub/local-summary-agent.js'
import { persistResolvedProject, resolveHubProject } from '../hub/project-resolution.js'
import { publishPreparedShare } from '../hub/publish.js'
import { formatRedactSummary, scanRecordsForSecrets } from '../hub/redact-gate.js'
import { prepareShare, type PreparedShare } from '../hub/share-pipeline.js'
import { resolveTeamReference } from '../hub/team-resolution.js'
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
  /**
   * Exact identity joined through sessions.project_id in the local index.
   *
   * Optional only at the injected resolver boundary for compatibility with
   * programmatic callers. The command fails closed before preparation or
   * upload when it is absent; it never substitutes the caller's cwd.
   */
  projectIdentity?: ProjectIdentity
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
  /** Existing Hub Project id or owner/slug. */
  project?: string
  /** Create and bind a Hub Project with this name. */
  createProject?: string
  /** Publish directly into a Team tenant instead of the personal default. */
  team?: string
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
  listTeams?: (client: HubClient) => Promise<HubTeam[]>
  cwd?: string
}

type ShareDisclosure =
  | { kind: 'public' }
  | { kind: 'link-only' }
  | { kind: 'team'; id: string; name: string }

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
    if (options.project !== undefined && options.createProject !== undefined) {
      ui.error('`--project` and `--create-project` cannot be used together.')
      return 1
    }
    const { sessionUuid, position } = parseShareRef(input)
    const resolveTarget = dependencies.resolveTarget ?? resolveTargetFromIndex
    const target = resolveTarget(sessionUuid, cwd)
    if (!target.projectIdentity) {
      throw new Error(
        `Session ${target.sessionUuid} has no local Project identity. ` +
          'Refresh the local index or update the programmatic resolver before sharing.',
      )
    }
    const projectIdentity = target.projectIdentity
    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    if (!credentials.token) {
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      ui.info(formatCliInstallHint())
      return 1
    }
    const client = new HubClient({
      hubUrl: credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })

    if (options.summary !== undefined && options.summary.trim() === '') {
      ui.error('`--summary` cannot be empty. Omit it to use the local Agent flow.')
      return 1
    }
    if (options.summary !== undefined && Buffer.byteLength(options.summary, 'utf8') > 64 * 1024) {
      ui.error('`--summary` exceeds the 64 KiB UTF-8 limit.')
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

    const secrets = scanRecordsForSecrets(
      prepared.records.map((record) => sessionRecordData(record)),
    )
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

    const spoolFile =
      options.spoolFile === undefined ? null : await readSpoolFileObject(options.spoolFile)
    const existing = await existingSession(client, prepared.sid)
    const existingProject = existing?.project ?? null
    const requestedTeam =
      options.team === undefined
        ? undefined
        : await resolveRequestedTeam(client, options.team, dependencies)
    if (
      requestedTeam &&
      existingProject &&
      (existingProject.owner.kind !== 'team' || existingProject.owner.id !== requestedTeam.id)
    ) {
      throw new Error(
        `Session is already in Project ${existingProject.owner.handle ?? existingProject.owner.id}/${existingProject.slug}. ` +
          `Re-sharing preserves its remote Project; use \`${formatCliCommand(
            `visibility ${prepared.sid} team --team ${requestedTeam.id} --project <id|owner/slug>`,
          )}\` for an explicit ownership transfer.`,
      )
    }
    const disclosure = resolveShareDisclosure(existing, requestedTeam, target.provider)
    const visibilityConfirmation = shareConfirmation(disclosure)
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

    const resolvedProject = await resolveHubProject({
      client,
      ui,
      hubUrl: credentials.hubUrl,
      localIdentity: projectIdentity,
      tenant: requestedTeam
        ? { kind: 'team', id: requestedTeam.id }
        : existingProject?.owner.kind === 'team'
          ? { kind: 'team', id: existingProject.owner.id }
          : { kind: 'personal' },
      ...(options.project === undefined ? {} : { projectRef: options.project }),
      ...(options.createProject === undefined ? {} : { createProjectName: options.createProject }),
      existingProject,
      ...pickCredentialOptions(dependencies),
    })
    if (!resolvedProject) return 1

    if (!visibilityDisclosed) {
      ui.info(shareDisclosureInfo(disclosure, resolvedProject.project.name))
    }

    const directTeamTarget =
      requestedTeam === undefined ? {} : ({ visibility: 'team', teamId: requestedTeam.id } as const)
    const initialOwnershipExpectation =
      requestedTeam === undefined ? {} : { expectedTeamId: existing?.team?.id ?? null }
    const subsequentOwnershipExpectation =
      requestedTeam === undefined ? {} : { expectedTeamId: requestedTeam.id }
    const initialProjectWrite = {
      projectId: resolvedProject.project.id,
      expectedProjectId: existingProject?.id ?? null,
      ...directTeamTarget,
      ...initialOwnershipExpectation,
    }
    const subsequentProjectWrite = {
      projectId: resolvedProject.project.id,
      expectedProjectId: resolvedProject.project.id,
      ...directTeamTarget,
      ...subsequentOwnershipExpectation,
    }
    const initialSummary = existing?.summaryMd ?? null

    const upload = ui.spinner()
    upload.start('Uploading session')
    let url: string
    try {
      const published = await publishPreparedShare(client, prepared, {
        card,
        summary: initialSummary,
        spoolFile,
        ...initialProjectWrite,
        onUploadProgress: (uploaded, total) =>
          upload.message(`Uploading session objects ${uploaded}/${total}`),
      })
      url = published.url
      persistResolvedProject(resolvedProject, pickCredentialOptions(dependencies))
      upload.stop(`Uploaded ${prepared.count} records`)
    } catch (cause) {
      upload.error('Session upload failed')
      throw cause
    }
    await announceShareComplete(
      ui,
      url,
      disclosure,
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
          ...subsequentProjectWrite,
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
      const invalidSummary = bilingualSummaryValidationError(summary)
      if (invalidSummary) {
        throw new Error(`${agent.name} returned an invalid bilingual Summary: ${invalidSummary}`)
      }
      generation.message('Uploading generated Summary')
      await publishPreparedShare(client, prepared, {
        card,
        summary,
        spoolFile,
        ...subsequentProjectWrite,
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
      ui.info(formatCliInstallHint())
    } else {
      ui.error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

export function bilingualSummaryValidationError(summary: string): string | null {
  if (Buffer.byteLength(summary, 'utf8') > 64 * 1024) {
    return 'the UTF-8 document exceeds 64 KiB'
  }
  const parsed = parseSummaryFrontMatter(summary)
  if (parsed.titleOverflow) {
    return '`title` and `title_zh` must each be at most 96 characters'
  }
  if (!parsed.titles?.en || !parsed.titles.zh) {
    return 'both `title` and `title_zh` are required in leading front-matter'
  }
  if (!parsed.summaries?.en || !parsed.summaries.zh) {
    return 'both English and Simplified Chinese bodies must use the required Summary delimiters'
  }
  if (
    repeatsTitleAsFirstHeading(parsed.summaries.en, parsed.titles.en) ||
    repeatsTitleAsFirstHeading(parsed.summaries.zh, parsed.titles.zh)
  ) {
    return 'Summary bodies must not repeat the Session title as their first H1'
  }
  return null
}

function repeatsTitleAsFirstHeading(markdown: string, title: string): boolean {
  const first = markdown.split(/\r?\n/).find((line) => line.trim() !== '')
  if (!first || !/^\s{0,3}#\s+/.test(first)) return false
  const heading = stripClosingHeadingSequence(first.replace(/^\s{0,3}#\s+/, ''))
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return heading === title
}

function stripClosingHeadingSequence(heading: string): string {
  let end = heading.length
  while (end > 0 && heading[end - 1]!.trim() === '') end--

  let hashesStart = end
  while (hashesStart > 0 && heading[hashesStart - 1] === '#') hashesStart--
  if (hashesStart === end) return heading

  const separator = hashesStart - 1
  if (separator < 0 || heading[separator]!.trim() !== '') return heading
  return heading.slice(0, separator)
}

async function resolveRequestedTeam(
  client: HubClient,
  reference: string,
  dependencies: ShareCommandDependencies,
): Promise<HubTeam> {
  const teams = await (dependencies.listTeams ?? ((forClient) => forClient.listTeams()))(client)
  const team = resolveTeamReference(teams, reference)
  if (team) return team
  throw new Error(
    teams.length === 0
      ? 'You are not a member of any Team.'
      : `No Team matches "${reference}". Your Teams: ${teams
          .map((entry) => (entry.handle ? `@${entry.handle}` : entry.name))
          .join(', ')}`,
  )
}

function resolveShareDisclosure(
  existing: HubSessionMeta | null,
  requestedTeam: HubTeam | undefined,
  provider: SessionProvider,
): ShareDisclosure {
  if (requestedTeam) {
    return { kind: 'team', id: requestedTeam.id, name: requestedTeam.name }
  }
  if (existing?.visibility === 'team') {
    const id = existing.team?.id ?? existing.project?.owner.id ?? 'unknown'
    const name = existing.team?.name ?? existing.project?.owner.name ?? id
    return { kind: 'team', id, name }
  }
  if (existing?.visibility === 'public') return { kind: 'public' }
  if (existing?.visibility === 'link-only') return { kind: 'link-only' }
  return isDiscoverySessionProvider(provider) ? { kind: 'public' } : { kind: 'link-only' }
}

function shareConfirmation(disclosure: ShareDisclosure): string {
  if (disclosure.kind === 'team') {
    return (
      `Publish this Session to Team · ${disclosure.name}? ` +
      'Only current members can read it, and the Team owns the hosted Session.'
    )
  }
  return disclosure.kind === 'public'
    ? 'Publish this Session as Public? It can appear in Explore and search.'
    : 'Share this Session as Link-only? Anyone with the URL can read it.'
}

function shareDisclosureInfo(disclosure: ShareDisclosure, projectName: string): string {
  if (disclosure.kind === 'team') {
    return (
      `This Session will be Team · ${disclosure.name} / Project ${projectName}. ` +
      'Only current members can read it, and the Team owns the hosted Session.'
    )
  }
  return disclosure.kind === 'public'
    ? `This Session will be Public in Project ${projectName} and can appear in Explore and search.`
    : `This Session will be Link-only in Project ${projectName}; anyone with the URL can read it.`
}

async function announceShareComplete(
  ui: CliUi,
  url: string,
  disclosure: ShareDisclosure,
  copyToClipboard: (text: string) => boolean | Promise<boolean>,
): Promise<void> {
  ui.note(
    url,
    disclosure.kind === 'public'
      ? 'Public Session URL'
      : disclosure.kind === 'team'
        ? `Team · ${disclosure.name} Session URL`
        : 'Link-only URL',
  )
  let copied = false
  if (ui.interactive) {
    try {
      copied = await copyToClipboard(url)
    } catch {
      // Clipboard access is a convenience; a live share must still succeed.
    }
  }
  const result =
    disclosure.kind === 'public'
      ? 'Session published.'
      : disclosure.kind === 'team'
        ? `Session shared to Team · ${disclosure.name}.`
        : 'Session shared as Link-only.'
  ui.success(copied ? `${result} Link copied to clipboard.` : result)
  if (ui.interactive && !copied) {
    ui.info('Could not copy automatically. Copy the Session URL above to share it.')
  }
  if (disclosure.kind === 'public') {
    ui.info('This Session can appear in Explore and search. The source Session stays unchanged.')
  } else if (disclosure.kind === 'team') {
    ui.info(
      `Only current members of Team · ${disclosure.name} can read it, and the Team owns the hosted Session.`,
    )
  } else {
    ui.info('Anyone with the URL can read it; it does not appear in Explore or search.')
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
    'Upload exactly this Markdown; does not generate a Summary (advanced)',
  )
  .option('--no-agent-summary', 'Do not offer to generate a Summary with a local Agent')
  .option('--visibility-confirmed', 'Acknowledge visibility when running without a TTY')
  .option('--yes', 'Skip all confirmations, including secret findings')
  .option('--spool-file <path>', 'Attach a .spool document to the share')
  .option('--team <handle-name-or-id>', 'Publish directly to this Team')
  .option('--project <id-or-owner-slug>', 'Publish to this Hub Project')
  .option('--create-project <name>', 'Create and bind a Hub Project')
  .action(
    async (
      session: string | undefined,
      opts: {
        summary?: string
        agentSummary: boolean
        visibilityConfirmed?: boolean
        yes?: boolean
        spoolFile?: string
        team?: string
        project?: string
        createProject?: string
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
          ...(opts.team === undefined ? {} : { team: opts.team }),
          ...(opts.project === undefined ? {} : { project: opts.project }),
          ...(opts.createProject === undefined ? {} : { createProject: opts.createProject }),
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
  const raw = prepared.records.map((record) => sessionRecordData(record)).join('\n')
  const parsed = parseSessionText(target.provider, raw, target.filePath)
  if (parsed.kind !== 'parsed') {
    throw new Error('Could not extract the shared conversation for Summary generation.')
  }
  return buildSessionSummaryPrompt(parsed.session, parsed.session.messages).prompt
}

async function existingSession(client: HubClient, sid: string): Promise<HubSessionMeta | null> {
  try {
    return await client.getSession(sid)
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
      `Session not found in the local index: ${uuid} (run \`spool\` to refresh the index?)`,
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
    projectIdentity: resolveSessionProjectIdentity(db, session.sessionUuid),
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
    `No indexed sessions for ${cwd}. Pass a session UUID or run \`spool\` to refresh the index.`,
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
