import { homedir } from 'node:os'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import type { ProjectIdentity, ProjectIdentityKind } from '../types.js'
import { fallbackDisplayName } from './display-name.js'
import { DEFAULT_RESOLVERS, type WorktreeUpstreamResolver } from './worktree-resolvers.js'
import { DEFAULT_SYNTHESIZERS, type IdentitySynthesizer } from './identity-synthesizers.js'

export interface IdentityFs {
  exists(path: string): boolean
  readText(path: string): string | null
  spawn(cmd: string, args: string[], opts: { cwd: string }): { stdout: string; exitCode: number }
}

const MANIFESTS = [
  'package.json', 'Cargo.toml', 'pyproject.toml',
  'go.mod', 'Gemfile', 'pom.xml', 'build.gradle',
] as const

const PARSEABLE_MANIFESTS = [
  'package.json', 'Cargo.toml', 'pyproject.toml',
] as const

const LOOSE_DIRS = new Set([
  '/tmp', '/private/tmp',
])
const LOOSE_HOME_DIRS = ['Desktop', 'Downloads', 'Documents']

export function normalizeGitRemote(url: string): string | null {
  if (!url) return null
  let s = url.trim().replace(/\.git$/, '')
  // git@host:owner/repo  →  host/owner/repo
  const sshMatch = s.match(/^[^@]+@([^:]+):(.+)$/)
  if (sshMatch) s = `${sshMatch[1]}/${sshMatch[2]}`
  // strip protocol + credentials
  s = s.replace(/^[a-z]+:\/\/(?:[^@/]*@)?/i, '')
  if (!s.includes('/')) return null
  return s.toLowerCase()
}

export function computeIdentity(
  cwd: string | null,
  fs: IdentityFs,
  resolvers: readonly WorktreeUpstreamResolver[] = DEFAULT_RESOLVERS,
  synthesizers: readonly IdentitySynthesizer[] = DEFAULT_SYNTHESIZERS,
  gitRemoteHint: string | null = null,
): ProjectIdentity {
  // Provider-recorded metadata is the strongest signal: it was captured while
  // the checkout still existed, so it remains valid after a worktree is
  // deleted or its parent directory is moved.
  const hintedRemote = normalizeGitRemote(gitRemoteHint ?? '')
  if (hintedRemote) {
    return {
      kind: 'git_remote',
      key: hintedRemote,
      displayName: deriveDisplayName({ kind: 'git_remote', key: hintedRemote, fs }),
    }
  }

  if (!cwd) return loose()

  const home = homedir()
  if (cwd === home || LOOSE_DIRS.has(cwd)) return loose()
  if (LOOSE_HOME_DIRS.some(d => cwd === join(home, d))) return loose()

  // 1. git
  const gitRoot = findGitRoot(cwd, fs)
  if (gitRoot) {
    const remote = fs.spawn('git', ['config', '--get', 'remote.origin.url'], { cwd: gitRoot })
    if (remote.exitCode === 0) {
      const norm = normalizeGitRemote(remote.stdout.trim())
      if (norm) {
        return {
          kind: 'git_remote',
          key: norm,
          displayName: deriveDisplayName({ kind: 'git_remote', key: norm, gitRoot, fs }),
        }
      }
    }
    const common = fs.spawn('git', ['rev-parse', '--git-common-dir'], { cwd: gitRoot })
    if (common.exitCode === 0) {
      const raw = common.stdout.trim()
      if (raw) {
        const key = isAbsolute(raw) ? raw : resolve(gitRoot, raw)
        return {
          kind: 'git_common_dir',
          key,
          displayName: deriveDisplayName({ kind: 'git_common_dir', key, gitRoot, fs }),
        }
      }
    }
  }

  // 2. manifest
  const manifestDir = findManifestDir(cwd, fs)
  if (manifestDir) {
    return {
      kind: 'manifest_path',
      key: manifestDir,
      displayName: deriveDisplayName({ kind: 'manifest_path', key: manifestDir, fs }),
    }
  }

  // 3. worktree resolvers — recover identity for sessions whose cwd has been
  // deleted (e.g. superset/git worktree torn down before Spool synced). The
  // resolver returns the upstream main-repo path; we recurse with empty
  // resolvers to prevent loops and to ensure the upstream goes through the
  // normal git/manifest detection on a real, existing path.
  if (!fs.exists(cwd) && resolvers.length > 0) {
    for (const r of resolvers) {
      const upstream = r.resolve(cwd)
      if (!upstream || !fs.exists(upstream)) continue
      const id = computeIdentity(upstream, fs, [], [])
      if (id.kind === 'git_remote' || id.kind === 'git_common_dir' || id.kind === 'manifest_path') {
        return id
      }
    }
  }

  // 4. identity synthesizers — collapse known scratch-workspace patterns
  // (e.g. Codex desktop's per-chat temp dirs under ~/Documents/Codex/<date>/)
  // into a single synthetic project. Only runs when no real project signal
  // was found above; a chat that happens to live inside a real git repo or
  // manifest still groups under that repo.
  for (const s of synthesizers) {
    const id = s.synthesize(cwd)
    if (id) return id
  }

  // 5. path
  return {
    kind: 'path',
    key: cwd,
    displayName: fallbackDisplayName(cwd),
  }
}

function loose(): ProjectIdentity {
  return { kind: 'loose', key: 'loose', displayName: 'Loose' }
}

function findGitRoot(start: string, fs: IdentityFs): string | null {
  let cur = start
  while (cur && cur !== '/') {
    if (fs.exists(join(cur, '.git'))) return cur
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

function findManifestDir(start: string, fs: IdentityFs): string | null {
  let cur = start
  while (cur && cur !== '/') {
    for (const m of MANIFESTS) {
      if (fs.exists(join(cur, m))) return cur
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

interface DisplayNameInput {
  kind: ProjectIdentityKind
  key: string
  gitRoot?: string
  fs: IdentityFs
}

function deriveDisplayName(input: DisplayNameInput): string {
  // Try manifest name first
  const dir = input.gitRoot ?? (input.kind === 'manifest_path' ? input.key : null)
  if (dir) {
    for (const m of PARSEABLE_MANIFESTS) {
      const p = join(dir, m)
      if (input.fs.exists(p)) {
        const name = parseManifestName(m, input.fs.readText(p) ?? '')
        if (name) return name
      }
    }
  }
  // git remote → last segment
  if (input.kind === 'git_remote') {
    const parts = input.key.split('/')
    return parts[parts.length - 1] || input.key
  }
  // common-dir or path → containing dir name
  if (input.gitRoot) return fallbackDisplayName(input.gitRoot)
  return fallbackDisplayName(input.key)
}

function parseManifestName(file: string, text: string): string | null {
  if (!text) return null
  if (file === 'package.json' || file === 'Cargo.toml' || file === 'pyproject.toml') {
    // Cheap regex: find name = "x" or "name": "x"
    const m =
      text.match(/"name"\s*:\s*"([^"]+)"/) ||
      text.match(/^\s*name\s*=\s*"([^"]+)"/m)
    if (m && m[1]) return m[1]
  }
  return null
}
