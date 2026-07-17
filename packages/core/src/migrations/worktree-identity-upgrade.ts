import type Database from 'better-sqlite3'
import { loadCodexSessionGitRemote } from '../parsers/codex.js'
import { computeIdentity, type IdentityFs } from '../projects/identity.js'

/**
 * v10 data migration: re-classify historical `path`-kind project rows whose
 * `identity_key` is a worktree path that has since been deleted.
 *
 * Before the worktree resolvers landed, a session synced AFTER its worktree
 * was torn down had no way to recover its upstream remote — `computeIdentity`
 * would walk up looking for `.git`, find nothing (the worktree was gone),
 * and fall through to `path` kind. That created an orphan project per
 * deleted worktree, even when the user had a perfectly good `spool` project
 * already grouped under `git_remote: github.com/spool-lab/spool`.
 *
 * This migration re-runs `computeIdentity` against the stored `identity_key`.
 * The resolver chain (Orca, then Superset) reads each worktree tool's
 * persistent registry to find the upstream main-repo path, runs git on it,
 * and returns a real `git_remote` / `git_common_dir` identity. Same identity
 * tuple as the parent project → `project_groups_v` collapses them into one
 * row in the sidebar without any explicit row merging. It originally shipped
 * as v10 and is also run on every DB open because resolver state can improve
 * independently of the schema version.
 *
 * Idempotent: re-running sees no `path`-kind candidates that resolve to a
 * different identity, so it's a no-op on the second pass. Rows that still
 * fail to resolve (e.g. genuine ad-hoc paths, or worktree tools we don't
 * have a resolver for yet) stay untouched.
 */

export interface WorktreeUpgradeResult {
  examined: number
  upgraded: number
}

export function upgradeWorktreeIdentities(
  db: Database.Database,
  fs: IdentityFs,
  readCodexGitRemote: (filePath: string) => string | null = loadCodexSessionGitRemote,
): WorktreeUpgradeResult {
  const rows = db.prepare(
    `SELECT id, identity_key FROM projects WHERE identity_kind = 'path'`,
  ).all() as Array<{ id: number; identity_key: string }>

  if (rows.length === 0) return { examined: 0, upgraded: 0 }

  const update = db.prepare(
    `UPDATE projects
     SET identity_kind = ?, identity_key = ?, display_name = ?
     WHERE id = ?`,
  )
  const codexFiles = db.prepare(`
    SELECT s.file_path
    FROM sessions s
    JOIN sources src ON src.id = s.source_id
    WHERE s.project_id = ? AND src.name = 'codex'
    ORDER BY s.started_at DESC
  `)

  let upgraded = 0
  for (const row of rows) {
    let id = computeIdentity(row.identity_key, fs)
    // Codex persists the remote in session_meta. This is the only durable
    // identity signal for historical rows whose checkout and worktree-tool
    // metadata are both gone, so consult it before accepting the path fallback.
    if (id.kind === 'path') {
      const files = codexFiles.all(row.id) as Array<{ file_path: string }>
      for (const file of files) {
        const remote = readCodexGitRemote(file.file_path)
        if (!remote) continue
        id = computeIdentity(row.identity_key, fs, [], [], remote)
        break
      }
    }
    // Only upgrade when the resolver produced something stronger than path.
    // (`loose` shouldn't happen here since we feed it a real cwd, but skip
    // defensively to avoid demoting rows.)
    if (id.kind === 'path' || id.kind === 'loose') continue
    update.run(id.kind, id.key, id.displayName, row.id)
    upgraded += 1
  }

  return { examined: rows.length, upgraded }
}
