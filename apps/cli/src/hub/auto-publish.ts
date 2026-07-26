import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  getDB,
  getSessionWithMessages,
  serializeIndexedSession,
  type ProjectIdentity,
} from '@spool-lab/core'
import {
  isDiscoverySessionProvider,
  isResumableSessionProvider,
  sessionRecordData,
  type SessionProvider,
} from '@spool-lab/session-kit'
import type Database from 'better-sqlite3'

import { loadSubscriptions, type Subscription } from '../subscriptions.js'
import type { CliUi } from '../ui.js'
import {
  HubClient,
  HubHttpError,
  type HubFetch,
  type HubProjectsResponse,
  type HubSessionMeta,
} from './client.js'
import { loadHubCredentials, normalizeHubUrl, type HubCredentialOptions } from './credentials.js'
import { publishPreparedShare } from './publish.js'
import { formatRedactSummary, scanRecordsForSecrets } from './redact-gate.js'
import { prepareShare, type PreparedShare } from './share-pipeline.js'
import { sessionMatchesSubscription, type SubscriptionMatchDeps } from './subscription-match.js'
import { buildWorkspaceCard, detectWorkspaceRoot } from './workspace.js'

// Continuous publishing for subscribed directories. Every candidate Session
// whose cwd belongs to a subscription (or one of its worktrees) is published
// without prompting; the visibility decision was made once at subscribe time.
// A fingerprint per Session avoids re-preparing unchanged transcripts, and
// Sessions with secret findings are skipped loudly — automation never gets to
// bypass the honesty gate.

export interface AutoPublishCandidate {
  provider: SessionProvider
  sessionUuid: string
  filePath: string
  cwd: string
  localIdentity: ProjectIdentity
  /** Portable JSONL for indexed sources without native provider records. */
  jsonl?: string
}

export interface AutoPublishResult {
  matched: number
  published: { sid: string; url: string }[]
  unchanged: number
  skippedSecrets: number
  skippedUnbound: number
  failed: number
}

interface AutoPublishStateEntry {
  fingerprint: string
  url?: string
  skippedSecrets?: boolean
}

interface AutoPublishState {
  version: 2
  sessions: Record<string, AutoPublishStateEntry>
}

export interface AutoPublishDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  match?: SubscriptionMatchDeps
  loadSubscriptions?: (options: HubCredentialOptions) => Subscription[]
  listCandidates?: () => AutoPublishCandidate[]
  prepare?: typeof prepareShare
  publish?: typeof publishPreparedShare
  listProjects?: (client: HubClient) => Promise<HubProjectsResponse>
  loadState?: () => AutoPublishState
  saveState?: (state: AutoPublishState) => void
  now?: () => string
}

export function autoPublishStatePath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmptyEnv(env['HOME']) ?? homedir()
  return join(home, '.spool', 'auto-publish-state.json')
}

/** Publish every subscribed Session that changed since the last pass.
 *  Returns null when nothing is subscribed so callers can stay silent. */
export async function runAutoPublish(
  ui: CliUi,
  dependencies: AutoPublishDependencies = {},
): Promise<AutoPublishResult | null> {
  const credentialOptions: HubCredentialOptions = {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
  const subscriptions = (dependencies.loadSubscriptions ?? loadSubscriptions)(credentialOptions)
  if (subscriptions.length === 0) return null

  const credentials = loadHubCredentials(credentialOptions)
  if (!credentials.token) {
    ui.warn('Subscribed directories are configured, but you are not logged in. Run `spool login`.')
    return null
  }

  const candidates = (dependencies.listCandidates ?? listCandidatesFromIndex)()
  const matched: Array<{ candidate: AutoPublishCandidate; subscription: Subscription }> = []
  for (const candidate of candidates) {
    const subscription = mostSpecificMatchingSubscription(
      candidate.cwd,
      subscriptions,
      dependencies.match ?? {},
    )
    if (subscription) matched.push({ candidate, subscription })
  }

  const result: AutoPublishResult = {
    matched: matched.length,
    published: [],
    unchanged: 0,
    skippedSecrets: 0,
    skippedUnbound: 0,
    failed: 0,
  }
  if (matched.length === 0) return result

  const loadState = dependencies.loadState ?? (() => readState(credentialOptions))
  const saveState =
    dependencies.saveState ?? ((state: AutoPublishState) => writeState(state, credentialOptions))
  const state = loadState()

  const client = new HubClient({
    hubUrl: credentials.hubUrl,
    token: credentials.token,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  })
  const listProjects = dependencies.listProjects ?? ((forClient) => forClient.listProjects())
  const projectsResponse = await listProjects(client)
  const prepare = dependencies.prepare ?? prepareShare
  const publish = dependencies.publish ?? publishPreparedShare
  const homeDir = dependencies.homeDir ?? homedir()
  const warnedUnboundPaths = new Set<string>()

  for (const { candidate, subscription } of matched) {
    const sid = `${candidate.provider}_${candidate.sessionUuid}`
    if (!subscription.project) {
      result.skippedUnbound += 1
      if (!warnedUnboundPaths.has(subscription.path)) {
        warnedUnboundPaths.add(subscription.path)
        ui.warn(
          `Skipped auto-publish for ${subscription.path}: this legacy subscription has no Hub Project. ` +
            `Run \`spool subscribe ${JSON.stringify(subscription.path)} --project <id|owner/slug>\` to bind it.`,
        )
      }
      continue
    }
    const bindingProblem = subscriptionProjectBindingProblem(
      subscription,
      credentials.hubUrl,
      projectsResponse,
    )
    if (bindingProblem) {
      result.skippedUnbound += 1
      if (!warnedUnboundPaths.has(subscription.path)) {
        warnedUnboundPaths.add(subscription.path)
        ui.warn(`Skipped auto-publish for ${subscription.path}: ${bindingProblem}`)
      }
      continue
    }
    if (
      subscription.project.localIdentity.kind !== candidate.localIdentity.kind ||
      subscription.project.localIdentity.key !== candidate.localIdentity.key
    ) {
      result.skippedUnbound += 1
      if (!warnedUnboundPaths.has(subscription.path)) {
        warnedUnboundPaths.add(subscription.path)
        ui.warn(
          `Skipped auto-publish for ${subscription.path}: its local Project no longer matches the subscription binding.`,
        )
      }
      continue
    }
    let jsonl: string
    try {
      jsonl = candidate.jsonl ?? readFileSync(candidate.filePath, 'utf8')
    } catch {
      // Provider file pruned between indexing and publish — nothing to send.
      continue
    }
    const stateKey = autoPublishStateKey(credentials.hubUrl, projectsResponse.actor.id, sid)
    const scopedFingerprint = publicationFingerprint(
      candidate,
      jsonl,
      subscription,
      credentials.hubUrl,
      projectsResponse.actor.id,
    )
    const previous = state.sessions[stateKey]
    if (previous?.fingerprint === scopedFingerprint) {
      result.unchanged += 1
      continue
    }

    let prepared: PreparedShare
    try {
      prepared = await prepare({
        provider: candidate.provider,
        sessionUuid: candidate.sessionUuid,
        jsonl,
        workspaceRoot: detectWorkspaceRoot(candidate.cwd),
        homeDir,
      })
    } catch (cause) {
      result.failed += 1
      ui.warn(`Could not prepare ${sid}: ${cause instanceof Error ? cause.message : String(cause)}`)
      continue
    }

    const secrets = scanRecordsForSecrets(
      prepared.records.map((record) => sessionRecordData(record)),
    )
    if (secrets.total > 0) {
      result.skippedSecrets += 1
      // Remember the fingerprint so the warning fires once per content change
      // instead of on every pass.
      state.sessions[stateKey] = { fingerprint: scopedFingerprint, skippedSecrets: true }
      ui.warn(
        `Skipped auto-publish of ${sid}.\n${formatRedactSummary(secrets)}\n` +
          'Review it and publish manually with `spool share` if intended.',
      )
      continue
    }

    try {
      const existing = await existingSession(client, prepared.sid)
      if (existing?.project && existing.project.id !== subscription.project.remote.id) {
        result.failed += 1
        ui.warn(
          `Could not publish ${sid}: the hosted Session belongs to Project ${existing.project.name}; ` +
            'automatic publishing will not move it silently.',
        )
        continue
      }
      const published = await publish(client, prepared, {
        card: buildWorkspaceCard(detectWorkspaceRoot(candidate.cwd)),
        summary: existing?.summaryMd ?? null,
        projectId: subscription.project.remote.id,
        expectedProjectId: existing?.project?.id ?? null,
        ...publishTarget(subscription, candidate.provider),
      })
      state.sessions[stateKey] = { fingerprint: scopedFingerprint, url: published.url }
      result.published.push({ sid, url: published.url })
    } catch (cause) {
      result.failed += 1
      ui.warn(`Could not publish ${sid}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  saveState(state)
  return result
}

/** One UI report per pass; quiet when nothing changed. */
export function reportAutoPublish(ui: CliUi, result: AutoPublishResult | null): void {
  if (result === null) return
  for (const entry of result.published) {
    ui.success(`Auto-published ${entry.sid} → ${entry.url}`)
  }
  if (result.failed > 0) {
    ui.warn(
      `${result.failed} subscribed session${result.failed === 1 ? '' : 's'} failed to publish.`,
    )
  }
  if (result.skippedUnbound > 0) {
    ui.warn(
      `${result.skippedUnbound} subscribed session${result.skippedUnbound === 1 ? '' : 's'} skipped because Project binding is missing or stale.`,
    )
  }
}

/** Map the subscribed disclosure to a publish target. Public is only sent
 *  for providers Explore supports; the hub rejects it otherwise, so degrade
 *  to Link-only instead of failing every pass. */
export function publishTarget(
  subscription: Subscription,
  provider: SessionProvider,
): { visibility: 'public' | 'link-only' } | { visibility: 'team'; teamId: string } {
  switch (subscription.visibility) {
    case 'team':
      return subscription.teamId !== undefined
        ? { visibility: 'team', teamId: subscription.teamId }
        : { visibility: 'link-only' }
    case 'public':
      return isDiscoverySessionProvider(provider)
        ? { visibility: 'public' }
        : { visibility: 'link-only' }
    case 'link-only':
      return { visibility: 'link-only' }
  }
}

/**
 * Read publish candidates from the real local index schema.
 *
 * Keep the database injectable so the production SQL is exercised against a
 * migrated SQLite database in tests. This query must not be replaced by a
 * hand-built fixture: schema drift here disables the daemon for every
 * subscription at once.
 */
export function listCandidatesFromIndex(
  db: Database.Database = getDB(true),
): AutoPublishCandidate[] {
  const rows = db
    .prepare(
      `SELECT s.session_uuid,
              src.name AS source,
              s.file_path,
              s.cwd,
              p.identity_kind,
              p.identity_key,
              p.display_name
       FROM sessions s
       JOIN sources src ON src.id = s.source_id
       JOIN projects p ON p.id = s.project_id
       WHERE s.cwd IS NOT NULL
         AND s.file_path NOT LIKE 'spool:%'
         AND p.identity_kind IS NOT NULL
         AND p.identity_key IS NOT NULL
       ORDER BY s.ended_at DESC`,
    )
    .all() as Array<{
    session_uuid: string
    source: SessionProvider
    file_path: string
    cwd: string
    identity_kind: ProjectIdentity['kind']
    identity_key: string
    display_name: string
  }>
  const candidates: AutoPublishCandidate[] = []
  for (const row of rows) {
    if (isResumableSessionProvider(row.source)) {
      candidates.push({
        provider: row.source,
        sessionUuid: row.session_uuid,
        filePath: row.file_path,
        cwd: row.cwd,
        localIdentity: {
          kind: row.identity_kind,
          key: row.identity_key,
          displayName: row.display_name,
        },
      })
      continue
    }
    const found = getSessionWithMessages(db, row.session_uuid)
    if (!found) continue
    candidates.push({
      provider: row.source,
      sessionUuid: row.session_uuid,
      filePath: row.file_path,
      cwd: row.cwd,
      localIdentity: {
        kind: row.identity_kind,
        key: row.identity_key,
        displayName: row.display_name,
      },
      jsonl: serializeIndexedSession(found.session, found.messages),
    })
  }
  return candidates
}

/** File-backed providers fingerprint by stat (cheap, no read); serialized
 *  sources hash their portable JSONL, since e.g. OpenCode stores every
 *  session in one database file whose mtime moves for unrelated sessions. */
function candidateFingerprint(candidate: AutoPublishCandidate, jsonl: string): string {
  if (candidate.jsonl === undefined) {
    try {
      const stats = statSync(candidate.filePath)
      return `stat:${stats.size}:${stats.mtimeMs}`
    } catch {
      // Fall through to content hashing when stat races a file move.
    }
  }
  return `sha256:${createHash('sha256').update(jsonl).digest('hex')}`
}

function publicationFingerprint(
  candidate: AutoPublishCandidate,
  jsonl: string,
  subscription: Subscription,
  hubUrl: string,
  actorId: string,
): string {
  return `sha256:${createHash('sha256')
    .update(candidateFingerprint(candidate, jsonl))
    .update(
      JSON.stringify({
        hubUrl: normalizeHubUrl(hubUrl),
        actorId,
        visibility: subscription.visibility,
        teamId: subscription.teamId ?? null,
        projectId: subscription.project?.remote.id ?? null,
        tenant: subscription.project?.tenant ?? null,
      }),
    )
    .digest('hex')}`
}

export function autoPublishStateKey(hubUrl: string, actorId: string, sid: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ hubUrl: normalizeHubUrl(hubUrl), actorId, sid }))
    .digest('hex')
  return `hub-session-${digest}`
}

/**
 * Nested subscriptions are valid: a monorepo may have a broad default while
 * one package publishes to a different Hub Project. Always choose the deepest
 * matching root so file order cannot silently decide the remote Project.
 */
export function mostSpecificMatchingSubscription(
  sessionCwd: string,
  subscriptions: readonly Subscription[],
  deps: SubscriptionMatchDeps = {},
): Subscription | undefined {
  let selected: Subscription | undefined
  let selectedDepth = -1
  let selectedLength = -1
  for (const subscription of subscriptions) {
    if (!sessionMatchesSubscription(sessionCwd, subscription.path, deps)) continue
    const depth = subscriptionPathDepth(subscription.path)
    if (
      selected === undefined ||
      depth > selectedDepth ||
      (depth === selectedDepth && subscription.path.length > selectedLength)
    ) {
      selected = subscription
      selectedDepth = depth
      selectedLength = subscription.path.length
    }
  }
  return selected
}

function subscriptionPathDepth(path: string): number {
  return path.split(/[\\/]+/).filter(Boolean).length
}

function subscriptionProjectBindingProblem(
  subscription: Subscription,
  currentHubUrl: string,
  response: HubProjectsResponse,
): string | null {
  const binding = subscription.project
  if (!binding) return 'this legacy subscription has no Hub Project binding.'
  if (normalizeHubUrl(binding.hubUrl) !== normalizeHubUrl(currentHubUrl)) {
    return 'its Project binding belongs to a different Hub. Run `spool subscribe` again.'
  }
  if (binding.actorId !== response.actor.id) {
    return 'its Project binding belongs to a different signed-in account. Run `spool subscribe` again.'
  }
  if (
    binding.remote.owner.kind !== binding.tenant.kind ||
    binding.remote.owner.id !== binding.tenant.id
  ) {
    return 'its saved Project and tenant no longer agree. Run `spool subscribe` again.'
  }
  if (subscription.visibility === 'team') {
    if (
      binding.tenant.kind !== 'team' ||
      !subscription.teamId ||
      binding.tenant.id !== subscription.teamId
    ) {
      return 'its Team disclosure and Project tenant no longer agree. Run `spool subscribe` again.'
    }
  } else if (binding.tenant.kind !== 'user' || binding.tenant.id !== response.actor.id) {
    return 'its personal disclosure is bound to another tenant. Run `spool subscribe` again.'
  }
  const live = response.projects.find(
    (project) =>
      project.id === binding.remote.id &&
      project.owner.kind === binding.tenant.kind &&
      project.owner.id === binding.tenant.id,
  )
  if (!live) {
    return 'its Project no longer exists or is not writable. Run `spool subscribe` again.'
  }
  return null
}

async function existingSession(client: HubClient, sid: string): Promise<HubSessionMeta | null> {
  try {
    return await client.getSession(sid)
  } catch (cause) {
    if (cause instanceof HubHttpError && (cause.status === 404 || cause.status === 410)) return null
    throw cause
  }
}

function readState(options: HubCredentialOptions): AutoPublishState {
  const path = autoPublishStatePath(options)
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 2 &&
      typeof (parsed as AutoPublishState).sessions === 'object' &&
      (parsed as AutoPublishState).sessions !== null
    ) {
      return { version: 2, sessions: (parsed as AutoPublishState).sessions }
    }
  } catch {
    // Missing or corrupt state only costs a re-publish pass; never fail sync.
  }
  return { version: 2, sessions: {} }
}

function writeState(state: AutoPublishState, options: HubCredentialOptions): void {
  const path = autoPublishStatePath(options)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
