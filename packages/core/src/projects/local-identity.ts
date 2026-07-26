import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type Database from 'better-sqlite3'

import type { ProjectIdentity, ProjectIdentityKind } from '../types.js'
import { realFs } from './fs.js'
import { listProjectGroups } from './groups.js'
import { computeIdentity } from './identity.js'

/** Match a live cwd to an identity already present in the local index. */
export function resolveLocalProjectIdentity(db: Database.Database, cwd: string): ProjectIdentity {
  const computed = computeIdentity(cwd, realFs)
  const groups = listProjectGroups(db, { withPaths: true })

  const direct = groups.find(
    (group) => group.identityKind === computed.kind && group.identityKey === computed.key,
  )
  if (direct) return identityFromGroup(direct)

  if (isAbsolute(computed.key)) {
    const canonicalKey = canonicalPath(computed.key)
    const canonical = groups.find(
      (group) =>
        group.identityKind === computed.kind &&
        isAbsolute(group.identityKey) &&
        canonicalPath(group.identityKey) === canonicalKey,
    )
    if (canonical) return identityFromGroup(canonical)
  }

  const canonicalCwd = canonicalPath(cwd)
  const nearby = groups
    .map((group) => ({
      group,
      distance: closestPathDistance(canonicalCwd, [...group.displayPaths, ...group.cwds]),
    }))
    .filter(
      (candidate): candidate is typeof candidate & { distance: number } =>
        candidate.distance !== null,
    )
    .sort((a, b) => a.distance - b.distance)[0]

  return nearby ? identityFromGroup(nearby.group) : computed
}

/**
 * Resolve the exact local Project identity joined to an indexed Session.
 *
 * This deliberately does not inspect the caller's cwd: an explicit
 * `spool share <session>` must bind the Project that owns that Session in the
 * index, even when the command is invoked from another checkout.
 */
export function resolveSessionProjectIdentity(
  db: Database.Database,
  sessionUuid: string,
): ProjectIdentity {
  const row = db
    .prepare(
      `SELECT p.identity_kind AS identityKind,
              p.identity_key AS identityKey,
              p.display_name AS displayName
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.session_uuid = ?`,
    )
    .get(sessionUuid) as
    | { identityKind: string | null; identityKey: string | null; displayName: string }
    | undefined

  if (!row) throw new Error(`Session not found in the local index: ${sessionUuid}`)
  if (!isProjectIdentityKind(row.identityKind) || !row.identityKey) {
    throw new Error(
      `Session ${sessionUuid} has no local Project identity. Run \`spool\` to refresh the index.`,
    )
  }
  return {
    kind: row.identityKind,
    key: row.identityKey,
    displayName: row.displayName,
  }
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

function identityFromGroup(group: {
  identityKind: ProjectIdentity['kind']
  identityKey: string
  displayName: string
}): ProjectIdentity {
  return {
    kind: group.identityKind,
    key: group.identityKey,
    displayName: group.displayName,
  }
}

function closestPathDistance(cwd: string, paths: string[]): number | null {
  let closest: number | null = null
  for (const path of paths) {
    if (!isAbsolute(path)) continue
    const candidate = canonicalPath(path)
    const distance = containingPathDistance(cwd, candidate)
    if (distance !== null && (closest === null || distance < closest)) closest = distance
  }
  return closest
}

function containingPathDistance(cwd: string, projectPath: string): number | null {
  const projectToCwd = relative(projectPath, cwd)
  return isContainedRelativePath(projectToCwd) ? pathDepth(projectToCwd) : null
}

function isContainedRelativePath(path: string): boolean {
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function pathDepth(path: string): number {
  return path === '' ? 0 : path.split(sep).filter(Boolean).length
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
