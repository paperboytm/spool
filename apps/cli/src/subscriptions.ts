import { chmodSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import type { ProjectIdentityKind } from '@spool-lab/core'

import type { HubProject } from './hub/client.js'
import { normalizeHubUrl, type HubCredentialOptions } from './hub/credentials.js'
import type { ProjectBindingTenant } from './hub/project-bindings.js'

// A subscription marks a project directory whose Sessions — including those
// recorded from its git worktrees — publish automatically on every sync. The
// visibility decision is made once, at subscribe time, so continuous syncing
// never has to prompt again. There is deliberately no implicit default:
// Public is always an explicit choice, never a fallback.

export type SubscriptionVisibility = 'public' | 'link-only' | 'team'

export interface Subscription {
  /** Absolute, symlink-resolved directory path. */
  path: string
  visibility: SubscriptionVisibility
  /** Required when visibility is 'team'. */
  teamId?: string
  /** Display-only; the id is authoritative. */
  teamName?: string
  /** Absent only on legacy v1/v2 entries, which must not auto-publish. */
  project?: {
    hubUrl: string
    actorId: string
    tenant: ProjectBindingTenant
    localIdentity: {
      kind: ProjectIdentityKind
      key: string
      displayName: string
    }
    remote: HubProject
  }
  addedAt: string
}

interface SubscriptionsFile {
  version: 3
  subscriptions: Subscription[]
}

export function subscriptionsPath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, '.spool', 'subscriptions.json')
}

export function loadSubscriptions(options: HubCredentialOptions = {}): Subscription[] {
  const path = subscriptionsPath(options)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Invalid subscriptions file at ${path}: ${message}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['subscriptions'])) {
    throw new Error(`Invalid subscriptions file at ${path}: expected { subscriptions: [] }`)
  }
  if (
    parsed['version'] !== undefined &&
    parsed['version'] !== 1 &&
    parsed['version'] !== 2 &&
    parsed['version'] !== 3
  ) {
    throw new Error(`Invalid subscriptions file at ${path}: unsupported version`)
  }
  const version = parsed['version'] === 3 ? 3 : parsed['version'] === 2 ? 2 : 1
  return parsed['subscriptions'].map((value, index) =>
    parseSubscription(value, index, path, version),
  )
}

export function saveSubscriptions(
  subscriptions: readonly Subscription[],
  options: HubCredentialOptions = {},
): string {
  const path = subscriptionsPath(options)
  const stored: SubscriptionsFile = { version: 3, subscriptions: [...subscriptions] }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(path, 0o600)
  return path
}

/** Resolve a user-supplied directory to the canonical form stored in a
 *  subscription. Throws when the path does not exist or is not a directory. */
export function canonicalSubscriptionPath(input: string, cwd: string = process.cwd()): string {
  const absolute = isAbsolute(input) ? input : resolve(cwd, input)
  const canonical = realpathSync(absolute)
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`Not a directory: ${canonical}`)
  }
  return canonical
}

export function addSubscription(
  subscription: Subscription,
  options: HubCredentialOptions = {},
): { added: boolean; subscriptions: Subscription[] } {
  const existing = loadSubscriptions(options)
  const found = existing.find((entry) => entry.path === subscription.path)
  if (found) {
    if (
      found.visibility === subscription.visibility &&
      found.teamId === subscription.teamId &&
      found.project?.hubUrl === subscription.project?.hubUrl &&
      found.project?.actorId === subscription.project?.actorId &&
      found.project?.tenant.kind === subscription.project?.tenant.kind &&
      found.project?.tenant.id === subscription.project?.tenant.id &&
      found.project?.remote.id === subscription.project?.remote.id &&
      found.project?.localIdentity.kind === subscription.project?.localIdentity.kind &&
      found.project?.localIdentity.key === subscription.project?.localIdentity.key
    ) {
      return { added: false, subscriptions: existing }
    }
    const updated = existing.map((entry) =>
      entry.path === subscription.path
        ? { ...subscription, addedAt: entry.addedAt || subscription.addedAt }
        : entry,
    )
    saveSubscriptions(updated, options)
    return { added: false, subscriptions: updated }
  }
  const updated = [...existing, subscription]
  saveSubscriptions(updated, options)
  return { added: true, subscriptions: updated }
}

export function removeSubscription(
  path: string,
  options: HubCredentialOptions = {},
): { removed: boolean; subscriptions: Subscription[] } {
  const existing = loadSubscriptions(options)
  const remaining = existing.filter((entry) => entry.path !== path)
  if (remaining.length === existing.length) return { removed: false, subscriptions: existing }
  saveSubscriptions(remaining, options)
  return { removed: true, subscriptions: remaining }
}

function parseSubscription(
  value: unknown,
  index: number,
  path: string,
  version: 1 | 2 | 3,
): Subscription {
  if (!isRecord(value) || typeof value['path'] !== 'string' || value['path'].trim() === '') {
    throw new Error(`Invalid subscriptions file at ${path}: entry ${index} has no path`)
  }
  // Unknown visibility values (from a newer or older CLI) degrade to the
  // safest disclosure rather than the widest.
  const teamId =
    typeof value['teamId'] === 'string' && value['teamId'] ? value['teamId'] : undefined
  const visibility: SubscriptionVisibility =
    value['visibility'] === 'public'
      ? 'public'
      : value['visibility'] === 'team' && teamId !== undefined
        ? 'team'
        : 'link-only'
  const teamName =
    typeof value['teamName'] === 'string' && value['teamName'] ? value['teamName'] : undefined
  const addedAt = typeof value['addedAt'] === 'string' ? value['addedAt'] : ''
  const project =
    version === 3 && value['project'] !== undefined
      ? parseSubscriptionProject(value['project'], index, path)
      : undefined
  return {
    path: value['path'],
    visibility,
    ...(visibility === 'team' && teamId !== undefined ? { teamId } : {}),
    ...(visibility === 'team' && teamName !== undefined ? { teamName } : {}),
    ...(project === undefined ? {} : { project }),
    addedAt,
  }
}

function parseSubscriptionProject(
  value: unknown,
  index: number,
  path: string,
): NonNullable<Subscription['project']> {
  if (
    !isRecord(value) ||
    typeof value['hubUrl'] !== 'string' ||
    typeof value['actorId'] !== 'string' ||
    !isProjectBindingTenant(value['tenant']) ||
    !isRecord(value['localIdentity']) ||
    !isProjectIdentityKind(value['localIdentity']['kind']) ||
    typeof value['localIdentity']['key'] !== 'string' ||
    typeof value['localIdentity']['displayName'] !== 'string' ||
    !isHubProject(value['remote'])
  ) {
    throw new Error(`Invalid subscriptions file at ${path}: entry ${index} has no Project binding`)
  }
  return {
    hubUrl: normalizeHubUrl(value['hubUrl']),
    actorId: value['actorId'],
    tenant: value['tenant'],
    localIdentity: {
      kind: value['localIdentity']['kind'],
      key: value['localIdentity']['key'],
      displayName: value['localIdentity']['displayName'],
    },
    remote: value['remote'],
  }
}

function isProjectBindingTenant(value: unknown): value is ProjectBindingTenant {
  return (
    isRecord(value) &&
    (value['kind'] === 'user' || value['kind'] === 'team') &&
    typeof value['id'] === 'string' &&
    value['id'] !== ''
  )
}

function isHubProject(value: unknown): value is HubProject {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['slug'] === 'string' &&
    typeof value['name'] === 'string' &&
    (value['description'] === null || typeof value['description'] === 'string') &&
    (value['github_url'] === null || typeof value['github_url'] === 'string') &&
    typeof value['can_manage'] === 'boolean' &&
    isRecord(value['owner']) &&
    (value['owner']['kind'] === 'user' || value['owner']['kind'] === 'team') &&
    typeof value['owner']['id'] === 'string' &&
    (value['owner']['handle'] === null || typeof value['owner']['handle'] === 'string') &&
    (value['owner']['name'] === null || typeof value['owner']['name'] === 'string')
  )
}

const PROJECT_IDENTITY_KINDS = new Set<ProjectIdentityKind>([
  'git_remote',
  'git_common_dir',
  'manifest_path',
  'synthetic',
  'path',
  'loose',
  'spool_internal',
])

function isProjectIdentityKind(value: unknown): value is ProjectIdentityKind {
  return typeof value === 'string' && PROJECT_IDENTITY_KINDS.has(value as ProjectIdentityKind)
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error
}
