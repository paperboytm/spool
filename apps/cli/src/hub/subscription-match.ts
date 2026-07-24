import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, sep } from 'node:path'

import { DEFAULT_RESOLVERS, type WorktreeUpstreamResolver } from '@spool-lab/core'

// Decides whether a Session belongs to a subscribed directory. A match is any
// of: the session cwd lives inside the subscription, inside one of the
// repository's linked git worktrees, or a worktree-manager resolver maps the
// cwd back to the subscribed main repository.

export interface SubscriptionMatchDeps {
  resolvers?: readonly WorktreeUpstreamResolver[]
  listWorktrees?: (repoPath: string) => string[]
}

export function isPathWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/** Enumerate linked worktrees of a git repository without spawning git:
 *  each `.git/worktrees/<name>/gitdir` file records the absolute path of the
 *  worktree's `.git` entry, whose parent is the worktree itself. */
export function listGitWorktrees(repoPath: string): string[] {
  const worktreesDir = join(repoPath, '.git', 'worktrees')
  let entries: string[]
  try {
    entries = readdirSync(worktreesDir)
  } catch {
    return []
  }
  const worktrees: string[] = []
  for (const entry of entries) {
    try {
      const gitdir = readFileSync(join(worktreesDir, entry, 'gitdir'), 'utf8').trim()
      if (gitdir && isAbsolute(gitdir)) worktrees.push(dirname(gitdir))
    } catch {
      // A pruned or half-written worktree entry must not break matching.
    }
  }
  return worktrees
}

export function sessionMatchesSubscription(
  sessionCwd: string,
  subscriptionPath: string,
  deps: SubscriptionMatchDeps = {},
): boolean {
  const cwd = canonicalExistingPath(sessionCwd)
  const subscription = canonicalExistingPath(subscriptionPath)
  if (isPathWithin(cwd, subscription)) return true

  const listWorktrees = deps.listWorktrees ?? listGitWorktrees
  for (const worktree of listWorktrees(subscription)) {
    if (isPathWithin(cwd, canonicalExistingPath(worktree))) return true
  }

  // Worktree managers (superset, orca, …) can map a session cwd — even a
  // deleted one — back to its upstream main repository.
  for (const resolver of deps.resolvers ?? DEFAULT_RESOLVERS) {
    const upstream = resolver.resolve(cwd) ?? resolver.resolve(sessionCwd)
    if (upstream !== null && canonicalExistingPath(upstream) === subscription) return true
  }
  return false
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
