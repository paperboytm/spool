import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { isPathWithin, listGitWorktrees, sessionMatchesSubscription } from './subscription-match.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Isolate from the machine's real worktree managers (superset/orca stores).
const NO_RESOLVERS = { resolvers: [] as const }

describe('isPathWithin', () => {
  it('matches the directory itself and nested paths only', () => {
    expect(isPathWithin('/a/b', '/a/b')).toBe(true)
    expect(isPathWithin('/a/b/c', '/a/b')).toBe(true)
    expect(isPathWithin('/a/bc', '/a/b')).toBe(false)
    expect(isPathWithin('/a', '/a/b')).toBe(false)
  })
})

describe('listGitWorktrees', () => {
  it('reads linked worktrees from .git/worktrees metadata', () => {
    const repo = tempDir('spool-match-repo-')
    const worktree = tempDir('spool-match-wt-')
    const meta = join(repo, '.git', 'worktrees', 'feature')
    mkdirSync(meta, { recursive: true })
    writeFileSync(join(meta, 'gitdir'), `${join(worktree, '.git')}\n`)
    // A pruned entry without a gitdir file must be ignored.
    mkdirSync(join(repo, '.git', 'worktrees', 'stale'), { recursive: true })

    expect(listGitWorktrees(repo)).toEqual([worktree])
    expect(listGitWorktrees(tempDir('spool-match-plain-'))).toEqual([])
  })
})

describe('sessionMatchesSubscription', () => {
  it('matches sessions recorded inside the subscribed directory', () => {
    const repo = tempDir('spool-match-repo-')
    expect(sessionMatchesSubscription(join(repo, 'src'), repo, NO_RESOLVERS)).toBe(true)
    expect(sessionMatchesSubscription(tempDir('spool-match-other-'), repo, NO_RESOLVERS)).toBe(
      false,
    )
  })

  it('matches sessions from the repository’s linked git worktrees', () => {
    const repo = tempDir('spool-match-repo-')
    const worktree = tempDir('spool-match-wt-')
    const meta = join(repo, '.git', 'worktrees', 'feature')
    mkdirSync(meta, { recursive: true })
    writeFileSync(join(meta, 'gitdir'), `${join(worktree, '.git')}\n`)

    expect(sessionMatchesSubscription(join(worktree, 'deep', 'dir'), repo, NO_RESOLVERS)).toBe(true)
  })

  it('matches deleted worktree cwds through upstream resolvers', () => {
    const repo = tempDir('spool-match-repo-')
    const goneCwd = '/gone/worktrees/spool/feature'
    const resolver = {
      name: 'test',
      resolve: (cwd: string) => (cwd === goneCwd ? repo : null),
    }
    expect(
      sessionMatchesSubscription(goneCwd, repo, { resolvers: [resolver], listWorktrees: () => [] }),
    ).toBe(true)
    expect(
      sessionMatchesSubscription('/gone/elsewhere', repo, {
        resolvers: [resolver],
        listWorktrees: () => [],
      }),
    ).toBe(false)
  })
})
