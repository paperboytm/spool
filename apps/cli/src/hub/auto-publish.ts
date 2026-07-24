import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { getDB, getSessionWithMessages, serializeIndexedSession } from '@spool-lab/core'
import {
  isDiscoverySessionProvider,
  isResumableSessionProvider,
  type SessionProvider,
} from '@spool-lab/session-kit'

import { loadSubscriptions, type Subscription } from '../subscriptions.js'
import type { CliUi } from '../ui.js'
import { HubClient, HubHttpError, type HubFetch } from './client.js'
import { loadHubCredentials, type HubCredentialOptions } from './credentials.js'
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
  /** Portable JSONL for indexed sources without native provider records. */
  jsonl?: string
}

export interface AutoPublishResult {
  matched: number
  published: { sid: string; url: string }[]
  unchanged: number
  skippedSecrets: number
  failed: number
}

interface AutoPublishStateEntry {
  fingerprint: string
  url?: string
  skippedSecrets?: boolean
}

interface AutoPublishState {
  version: 1
  sessions: Record<string, AutoPublishStateEntry>
}

export interface AutoPublishDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  match?: SubscriptionMatchDeps
  loadSubscriptions?: (options: HubCredentialOptions) => Subscription[]
  listCandidates?: () => AutoPublishCandidate[]
  prepare?: typeof prepareShare
  publish?: typeof publishPreparedShare
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
    const subscription = subscriptions.find((entry) =>
      sessionMatchesSubscription(candidate.cwd, entry.path, dependencies.match ?? {}),
    )
    if (subscription) matched.push({ candidate, subscription })
  }

  const result: AutoPublishResult = {
    matched: matched.length,
    published: [],
    unchanged: 0,
    skippedSecrets: 0,
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
  const prepare = dependencies.prepare ?? prepareShare
  const publish = dependencies.publish ?? publishPreparedShare
  const homeDir = dependencies.homeDir ?? homedir()

  for (const { candidate, subscription } of matched) {
    const sid = `${candidate.provider}_${candidate.sessionUuid}`
    let jsonl: string
    try {
      jsonl = candidate.jsonl ?? readFileSync(candidate.filePath, 'utf8')
    } catch {
      // Provider file pruned between indexing and publish — nothing to send.
      continue
    }
    const fingerprint = candidateFingerprint(candidate, jsonl)
    const previous = state.sessions[sid]
    if (previous?.fingerprint === fingerprint) {
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

    const secrets = scanRecordsForSecrets(prepared.records.map((record) => record.data))
    if (secrets.total > 0) {
      result.skippedSecrets += 1
      // Remember the fingerprint so the warning fires once per content change
      // instead of on every pass.
      state.sessions[sid] = { fingerprint, skippedSecrets: true }
      ui.warn(
        `Skipped auto-publish of ${sid}.\n${formatRedactSummary(secrets)}\n` +
          'Review it and publish manually with `spool share` if intended.',
      )
      continue
    }

    try {
      const summary = await existingSummary(client, prepared.sid)
      const published = await publish(client, prepared, {
        card: buildWorkspaceCard(detectWorkspaceRoot(candidate.cwd)),
        summary,
        ...publishTarget(subscription, candidate.provider),
      })
      state.sessions[sid] = { fingerprint, url: published.url }
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

function listCandidatesFromIndex(): AutoPublishCandidate[] {
  const db = getDB(true)
  const rows = db
    .prepare(
      `SELECT session_uuid, source, file_path, cwd FROM sessions
       WHERE cwd IS NOT NULL AND file_path NOT LIKE 'spool:%'
       ORDER BY ended_at DESC`,
    )
    .all() as Array<{
    session_uuid: string
    source: SessionProvider
    file_path: string
    cwd: string
  }>
  const candidates: AutoPublishCandidate[] = []
  for (const row of rows) {
    if (isResumableSessionProvider(row.source)) {
      candidates.push({
        provider: row.source,
        sessionUuid: row.session_uuid,
        filePath: row.file_path,
        cwd: row.cwd,
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

async function existingSummary(client: HubClient, sid: string): Promise<string | null> {
  try {
    return (await client.getSession(sid)).summaryMd
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
      typeof (parsed as AutoPublishState).sessions === 'object' &&
      (parsed as AutoPublishState).sessions !== null
    ) {
      return { version: 1, sessions: (parsed as AutoPublishState).sessions }
    }
  } catch {
    // Missing or corrupt state only costs a re-publish pass; never fail sync.
  }
  return { version: 1, sessions: {} }
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
