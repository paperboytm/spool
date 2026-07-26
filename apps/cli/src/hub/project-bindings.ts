import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ProjectIdentity, ProjectIdentityKind } from '@spool-lab/core'

import type { HubProject } from './client.js'
import { normalizeHubUrl, type HubCredentialOptions } from './credentials.js'

export interface ProjectBindingTenant {
  kind: 'user' | 'team'
  id: string
}

export interface ProjectBinding {
  hubUrl: string
  actorId: string
  tenant: ProjectBindingTenant
  localIdentity: {
    kind: ProjectIdentityKind
    key: string
    displayName: string
  }
  project: HubProject
  updatedAt: string
}

interface ProjectBindingsFile {
  version: 1
  bindings: ProjectBinding[]
}

export function projectBindingsPath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, '.spool', 'project-bindings.json')
}

export function loadProjectBindings(options: HubCredentialOptions = {}): ProjectBinding[] {
  const path = projectBindingsPath(options)
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
    throw new Error(
      `Invalid Project bindings at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!isRecord(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['bindings'])) {
    throw new Error(`Invalid Project bindings at ${path}: expected version 1 bindings`)
  }
  return parsed['bindings'].map((value, index) => parseBinding(value, index, path))
}

export function saveProjectBindings(
  bindings: readonly ProjectBinding[],
  options: HubCredentialOptions = {},
): string {
  const path = projectBindingsPath(options)
  const stored: ProjectBindingsFile = { version: 1, bindings: [...bindings] }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(path, 0o600)
  return path
}

export function findProjectBinding(
  bindings: readonly ProjectBinding[],
  input: {
    hubUrl: string
    actorId: string
    tenant: ProjectBindingTenant
    localIdentity: Pick<ProjectIdentity, 'kind' | 'key'>
  },
): ProjectBinding | undefined {
  const hubUrl = normalizeHubUrl(input.hubUrl)
  return bindings.find(
    (binding) =>
      binding.hubUrl === hubUrl &&
      binding.actorId === input.actorId &&
      binding.tenant.kind === input.tenant.kind &&
      binding.tenant.id === input.tenant.id &&
      binding.localIdentity.kind === input.localIdentity.kind &&
      binding.localIdentity.key === input.localIdentity.key,
  )
}

export function upsertProjectBinding(
  input: Omit<ProjectBinding, 'hubUrl' | 'updatedAt'> & {
    hubUrl: string
    updatedAt?: string
  },
  options: HubCredentialOptions = {},
): ProjectBinding {
  const binding: ProjectBinding = {
    ...input,
    hubUrl: normalizeHubUrl(input.hubUrl),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
  const existing = loadProjectBindings(options)
  const remaining = existing.filter(
    (entry) =>
      !(
        entry.hubUrl === binding.hubUrl &&
        entry.actorId === binding.actorId &&
        entry.tenant.kind === binding.tenant.kind &&
        entry.tenant.id === binding.tenant.id &&
        entry.localIdentity.kind === binding.localIdentity.kind &&
        entry.localIdentity.key === binding.localIdentity.key
      ),
  )
  saveProjectBindings([...remaining, binding], options)
  return binding
}

function parseBinding(value: unknown, index: number, path: string): ProjectBinding {
  if (
    !isRecord(value) ||
    typeof value['hubUrl'] !== 'string' ||
    typeof value['actorId'] !== 'string' ||
    !isTenant(value['tenant']) ||
    !isLocalIdentity(value['localIdentity']) ||
    !isHubProject(value['project']) ||
    typeof value['updatedAt'] !== 'string'
  ) {
    throw new Error(`Invalid Project bindings at ${path}: malformed entry ${index}`)
  }
  return {
    hubUrl: normalizeHubUrl(value['hubUrl']),
    actorId: value['actorId'],
    tenant: value['tenant'],
    localIdentity: value['localIdentity'],
    project: value['project'],
    updatedAt: value['updatedAt'],
  }
}

function isTenant(value: unknown): value is ProjectBindingTenant {
  return (
    isRecord(value) &&
    (value['kind'] === 'user' || value['kind'] === 'team') &&
    typeof value['id'] === 'string' &&
    value['id'] !== ''
  )
}

function isLocalIdentity(value: unknown): value is ProjectBinding['localIdentity'] {
  return (
    isRecord(value) &&
    isProjectIdentityKind(value['kind']) &&
    typeof value['key'] === 'string' &&
    value['key'] !== '' &&
    typeof value['displayName'] === 'string' &&
    value['displayName'] !== ''
  )
}

function isHubProject(value: unknown): value is HubProject {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['slug'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    !isHubProjectOwner(value['owner']) ||
    typeof value['can_manage'] !== 'boolean'
  ) {
    return false
  }
  return (
    (value['description'] === null || typeof value['description'] === 'string') &&
    (value['github_url'] === null || typeof value['github_url'] === 'string')
  )
}

function isHubProjectOwner(value: unknown): value is HubProject['owner'] {
  return (
    isRecord(value) &&
    (value['kind'] === 'user' || value['kind'] === 'team') &&
    typeof value['id'] === 'string' &&
    value['id'] !== '' &&
    (value['handle'] === null || typeof value['handle'] === 'string') &&
    (value['name'] === null || typeof value['name'] === 'string')
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
