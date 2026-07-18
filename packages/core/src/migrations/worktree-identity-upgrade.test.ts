import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { runMigrations } from '../db/db.js'
import type { IdentityFs } from '../projects/identity.js'
import { upgradeWorktreeIdentities } from './worktree-identity-upgrade.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

function seedProject(opts: {
  slug: string
  displayPath: string
  displayName: string
  identityKind: string
  identityKey: string
}): number {
  const r = db
    .prepare(
      `INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
     VALUES (1, ?, ?, ?, ?, ?)`,
    )
    .run(opts.slug, opts.displayPath, opts.displayName, opts.identityKind, opts.identityKey)
  return Number(r.lastInsertRowid)
}

function makeFs(opts: {
  liveGitRoots?: Record<string, { remote?: string; commonDir?: string }>
}): IdentityFs {
  const live = opts.liveGitRoots ?? {}
  return {
    exists: (p: string) => {
      // Path exists if it's a known live git root or its .git child.
      for (const root of Object.keys(live)) {
        if (p === root || p === `${root}/.git`) return true
      }
      return false
    },
    readText: () => null,
    spawn: (_cmd, args, callOpts) => {
      const ctx = live[callOpts.cwd]
      if (!ctx) return { stdout: '', exitCode: 1 }
      if (args.includes('remote.origin.url') && ctx.remote) {
        return { stdout: ctx.remote + '\n', exitCode: 0 }
      }
      if (args.includes('--git-common-dir') && ctx.commonDir) {
        return { stdout: ctx.commonDir + '\n', exitCode: 0 }
      }
      return { stdout: '', exitCode: 1 }
    },
  }
}

describe('upgradeWorktreeIdentities', () => {
  it('is a no-op when no path-kind projects exist', () => {
    const result = upgradeWorktreeIdentities(db, makeFs({}))
    expect(result).toEqual({ examined: 0, upgraded: 0 })
  })

  it('upgrades a path-kind row whose identity_key resolves to a live git repo', () => {
    // The row's identity_key happens to BE a live git repo path. computeIdentity
    // will find .git there and return git_remote — migration upgrades the row.
    const id = seedProject({
      slug: 'foo',
      displayPath: '/repos/foo',
      displayName: 'foo',
      identityKind: 'path',
      identityKey: '/repos/foo',
    })
    const fs = makeFs({
      liveGitRoots: { '/repos/foo': { remote: 'git@github.com:owner/foo.git' } },
    })
    const result = upgradeWorktreeIdentities(db, fs)
    expect(result).toEqual({ examined: 1, upgraded: 1 })

    const row = db
      .prepare(`SELECT identity_kind, identity_key FROM projects WHERE id = ?`)
      .get(id) as { identity_kind: string; identity_key: string }
    expect(row.identity_kind).toBe('git_remote')
    expect(row.identity_key).toBe('github.com/owner/foo')
  })

  it('groups deleted main and worktree paths from Codex session remote metadata', () => {
    const mainId = seedProject({
      slug: 'im-main',
      displayPath: '/Users/me/work/im',
      displayName: 'im',
      identityKind: 'path',
      identityKey: '/Users/me/work/im',
    })
    const worktreeId = seedProject({
      slug: 'im-worktree',
      displayPath: '/Users/me/.codex/worktrees/6ae2/im',
      displayName: 'im',
      identityKind: 'path',
      identityKey: '/Users/me/.codex/worktrees/6ae2/im',
    })
    const insertSession = db.prepare(`
      INSERT INTO sessions
        (project_id, source_id, session_uuid, file_path, started_at, ended_at, message_count)
      VALUES (?, 2, ?, ?, '2026-05-01', '2026-05-01', 1)
    `)
    insertSession.run(mainId, 'im-main-session', '/sessions/im-main.jsonl')
    insertSession.run(worktreeId, 'im-worktree-session', '/sessions/im-worktree.jsonl')

    const result = upgradeWorktreeIdentities(
      db,
      makeFs({}),
      () => 'git@github.com:paperboytm/im.git',
    )
    expect(result).toEqual({ examined: 2, upgraded: 2 })

    const rows = db
      .prepare(`
      SELECT identity_kind, identity_key
      FROM projects WHERE id IN (?, ?)
      ORDER BY id
    `)
      .all(mainId, worktreeId)
    expect(rows).toEqual([
      { identity_kind: 'git_remote', identity_key: 'github.com/paperboytm/im' },
      { identity_kind: 'git_remote', identity_key: 'github.com/paperboytm/im' },
    ])
    const groups = db
      .prepare(`
      SELECT COUNT(*) AS count
      FROM project_groups_v
      WHERE identity_key = 'github.com/paperboytm/im'
    `)
      .get() as { count: number }
    expect(groups.count).toBe(1)
  })

  it('leaves rows alone when computeIdentity still returns path', () => {
    // No live git root at this path — recompute also yields path-kind. Don't
    // touch the row (keeps migration idempotent on legitimately ad-hoc dirs).
    const id = seedProject({
      slug: 'scratch',
      displayPath: '/Users/me/scratch',
      displayName: 'scratch',
      identityKind: 'path',
      identityKey: '/Users/me/scratch',
    })
    const before = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Record<
      string,
      unknown
    >
    const result = upgradeWorktreeIdentities(db, makeFs({}))
    expect(result).toEqual({ examined: 1, upgraded: 0 })
    const after = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Record<
      string,
      unknown
    >
    expect(after).toEqual(before)
  })

  it('leaves git_remote and other non-path rows untouched', () => {
    const id = seedProject({
      slug: 'spool',
      displayPath: '/Users/me/spool',
      displayName: 'spool',
      identityKind: 'git_remote',
      identityKey: 'github.com/spool-lab/spool',
    })
    upgradeWorktreeIdentities(
      db,
      makeFs({
        liveGitRoots: { '/Users/me/spool': { remote: 'something-else' } },
      }),
    )
    const row = db
      .prepare(`SELECT identity_kind, identity_key FROM projects WHERE id = ?`)
      .get(id) as { identity_kind: string; identity_key: string }
    expect(row.identity_kind).toBe('git_remote')
    expect(row.identity_key).toBe('github.com/spool-lab/spool')
  })

  it('is idempotent on a second run', () => {
    seedProject({
      slug: 'foo',
      displayPath: '/repos/foo',
      displayName: 'foo',
      identityKind: 'path',
      identityKey: '/repos/foo',
    })
    const fs = makeFs({
      liveGitRoots: { '/repos/foo': { remote: 'git@github.com:owner/foo.git' } },
    })
    const first = upgradeWorktreeIdentities(db, fs)
    const second = upgradeWorktreeIdentities(db, fs)
    expect(first.upgraded).toBe(1)
    expect(second.upgraded).toBe(0)
    expect(second.examined).toBe(0) // already non-path, not even examined
  })
})
