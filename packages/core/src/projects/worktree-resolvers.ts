import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type Database from 'better-sqlite3'

import { openDatabase } from '../db/native-binding.js'

// Resolve home at call time (not module load) so tests can redirect via
// process.env.HOME. node:os.homedir() reads the OS user info on POSIX and
// ignores HOME, hence the explicit check first.
function getHome(): string {
  return process.env['HOME'] || homedir()
}

/**
 * Recovers the upstream main-repo path of a worktree session whose `cwd`
 * has already been deleted at sync time. This is the only signal that lets
 * Spool group such sessions under their real project — Claude Code's JSONL
 * carries `cwd` and `gitBranch` but no remote URL.
 *
 * Each implementation reads a worktree-tool-specific persistent store. If
 * the store is missing or the cwd doesn't match anything, return null and
 * the next resolver in the chain (or the existing path-kind fallback) wins.
 */
export interface WorktreeUpstreamResolver {
  name: string
  resolve(cwd: string): string | null
}

function supersetDbPath(): string {
  return join(getHome(), '.superset', 'local.db')
}
function supersetDefaultBase(): string {
  return join(getHome(), '.superset', 'worktrees')
}

interface SupersetProjectRow {
  name: string
  main_repo_path: string
  worktree_base_dir: string | null
}

let _supersetCache: { projects: SupersetProjectRow[]; globalBase: string } | null = null

interface OrcaRepoRow {
  id: string
  path: string
  displayName: string
}

interface OrcaData {
  repos?: unknown
  worktreeMeta?: unknown
}

interface OrcaWorktreeRow {
  path: string
  upstream: string
}

interface OrcaResolverState {
  repos: OrcaRepoRow[]
  worktrees: OrcaWorktreeRow[]
}

let _orcaCache: OrcaResolverState | null = null

function loadSupersetProjects(): { projects: SupersetProjectRow[]; globalBase: string } | null {
  if (_supersetCache) return _supersetCache
  const dbPath = supersetDbPath()
  if (!existsSync(dbPath)) return null

  let db: Database.Database | null = null
  try {
    db = openDatabase(dbPath, { readonly: true, fileMustExist: true })

    const settings = db.prepare(`SELECT worktree_base_dir FROM settings WHERE id = 1`).get() as
      | { worktree_base_dir: string | null }
      | undefined
    const globalBase = settings?.worktree_base_dir || supersetDefaultBase()

    const projects = db
      .prepare(`SELECT name, main_repo_path, worktree_base_dir FROM projects`)
      .all() as SupersetProjectRow[]

    _supersetCache = { projects, globalBase }
    return _supersetCache
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/** Test hook: reset the in-process cache so tests can stub the DB. */
export function _resetSupersetCacheForTests(): void {
  _supersetCache = null
}

/** Test hook: reset every persistent-store cache. */
export function _resetWorktreeResolverCachesForTests(): void {
  _supersetCache = null
  _orcaCache = null
}

export const supersetResolver: WorktreeUpstreamResolver = {
  name: 'superset',
  resolve(cwd: string): string | null {
    const data = loadSupersetProjects()
    if (!data) return null
    for (const p of data.projects) {
      if (!p.main_repo_path) continue
      const base = p.worktree_base_dir || data.globalBase
      // Convention enforced by superset: <base>/<project-name>/<branch>
      const projectDir = join(base, p.name)
      if (cwd === projectDir || cwd.startsWith(projectDir + '/')) {
        return p.main_repo_path
      }
    }
    return null
  },
}

function orcaDataPaths(): string[] {
  const home = getHome()
  const appData = process.env['APPDATA']
  return [
    join(home, 'Library', 'Application Support', 'orca', 'orca-data.json'),
    join(home, 'Library', 'Application Support', 'orca-dev', 'orca-data.json'),
    join(home, '.config', 'orca', 'orca-data.json'),
    join(home, '.config', 'orca-dev', 'orca-data.json'),
    ...(appData
      ? [join(appData, 'orca', 'orca-data.json'), join(appData, 'orca-dev', 'orca-data.json')]
      : []),
  ]
}

function loadOrcaState(): OrcaResolverState | null {
  if (_orcaCache) return _orcaCache

  const reposById = new Map<string, OrcaRepoRow>()
  const rawWorktrees: Array<{ repoId: string; path: string }> = []

  for (const dataPath of orcaDataPaths()) {
    if (!existsSync(dataPath)) continue
    try {
      const data = JSON.parse(readFileSync(dataPath, 'utf8')) as OrcaData
      if (Array.isArray(data.repos)) {
        for (const value of data.repos) {
          if (!isRecord(value)) continue
          const id = stringField(value, 'id')
          const path = stringField(value, 'path')
          if (!id || !path) continue
          reposById.set(id, {
            id,
            path,
            displayName: stringField(value, 'displayName') || basename(path),
          })
        }
      }

      if (isRecord(data.worktreeMeta)) {
        for (const [key, value] of Object.entries(data.worktreeMeta)) {
          const boundary = key.indexOf('::')
          if (boundary <= 0) continue
          const keyRepoId = key.slice(0, boundary)
          const path = key.slice(boundary + 2)
          if (!path) continue
          const repoId = isRecord(value)
            ? stringField(value, 'projectHostSetupId') || stringField(value, 'repoId') || keyRepoId
            : keyRepoId
          rawWorktrees.push({ repoId, path })
        }
      }
    } catch {
      // Orca writes this file atomically, but a concurrent/partial write or a
      // future incompatible shape must not make session indexing fail.
    }
  }

  if (reposById.size === 0) return null

  const worktreeByPath = new Map<string, OrcaWorktreeRow>()
  for (const repo of reposById.values()) {
    worktreeByPath.set(repo.path, { path: repo.path, upstream: repo.path })
  }
  for (const worktree of rawWorktrees) {
    const repo = reposById.get(worktree.repoId)
    if (!repo) continue
    worktreeByPath.set(worktree.path, { path: worktree.path, upstream: repo.path })
  }

  _orcaCache = {
    repos: [...reposById.values()],
    // Longest root wins when a cwd is nested under another recorded cwd.
    worktrees: [...worktreeByPath.values()].sort((a, b) => b.path.length - a.path.length),
  }
  return _orcaCache
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  return typeof field === 'string' ? field : ''
}

function managedWorktreeRepoName(cwd: string): string | null {
  // Orca's default nested layout: <base>/orca/workspaces/<repo>/<worktree>
  const orca = cwd.match(/(?:^|\/)orca\/workspaces\/([^/]+)\/[^/]+(?:\/|$)/)
  if (orca?.[1]) return orca[1]

  // Codex worktrees: ~/.codex/worktrees/<opaque-id>/<repo>[/subdir]
  const codex = cwd.match(/(?:^|\/)\.codex\/worktrees\/[^/]+\/([^/]+)(?:\/|$)/)
  return codex?.[1] ?? null
}

export const orcaResolver: WorktreeUpstreamResolver = {
  name: 'orca',
  resolve(cwd: string): string | null {
    const data = loadOrcaState()
    if (!data) return null

    // Prefer Orca's exact persisted worktree mapping. It survives worktree
    // deletion and does not depend on a naming convention.
    for (const worktree of data.worktrees) {
      if (cwd === worktree.path || cwd.startsWith(worktree.path + '/')) {
        return worktree.upstream
      }
    }

    // Old metadata can be pruned while transcripts remain forever. Both Orca
    // and Codex keep the repo name in their managed worktree path, so recover
    // only when that name identifies exactly one registered Orca repo. The
    // ambiguity check prevents same-named repos from different owners from
    // being merged.
    const repoName = managedWorktreeRepoName(cwd)
    if (!repoName) return null
    const candidates = new Set(
      data.repos
        .filter((repo) => repo.displayName === repoName || basename(repo.path) === repoName)
        .map((repo) => repo.path),
    )
    return candidates.size === 1 ? [...candidates][0]! : null
  },
}

export const DEFAULT_RESOLVERS: readonly WorktreeUpstreamResolver[] = Object.freeze([
  orcaResolver,
  supersetResolver,
])
