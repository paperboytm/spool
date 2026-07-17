import { execFileSync } from 'node:child_process'

// Workspace coordinates for the card (§3.1 of the v2 design): a convenience
// pointer, never a guarantee — every field degrades to null/[] when git is
// absent. The card rides on the head and is rendered as machine evidence.

export interface WorkspaceCard {
  remotes: string[]
  branch: string | null
  head: string | null
  dirty: string[]
  observed: string
}

const MAX_DIRTY_ENTRIES = 20

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

export function detectWorkspaceRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
}

export function buildWorkspaceCard(root: string, now: Date = new Date()): WorkspaceCard | null {
  const head = git(root, ['rev-parse', 'HEAD'])
  if (head === null) return null

  const remotes = (git(root, ['remote', '-v']) ?? '')
    .split('\n')
    .filter((line) => line.includes('(fetch)'))
    .map((line) => line.replace(/\s+\(fetch\)$/, '').replace(/\s+/, ': '))

  const dirty = (git(root, ['status', '--porcelain']) ?? '')
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3))
    .slice(0, MAX_DIRTY_ENTRIES)

  return {
    remotes,
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head,
    dirty,
    observed: now.toISOString(),
  }
}
