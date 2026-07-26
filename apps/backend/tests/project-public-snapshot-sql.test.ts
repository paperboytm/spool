import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import type { D1Database } from '@cloudflare/workers-types'
import { expect, it } from 'vite-plus/test'

import { listPublicProjectSessions } from '../src/projects/store'
import { getProjectSocialSnapshot, listProjectStargazers } from '../src/social/projects'

it('atomically hides a Team Project snapshot after its final Public Session is withdrawn', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec('PRAGMA foreign_keys=ON;')
    const migrations = join(import.meta.dirname, '../migrations')
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      sqlite.exec(readFileSync(join(migrations, name), 'utf8'))
    }
    const db = {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql)
        return {
          bind(...params: unknown[]) {
            const values = params as SQLInputValue[]
            return {
              async first() {
                return statement.get(...values) ?? null
              },
              async all() {
                return { results: statement.all(...values), success: true, meta: {} }
              },
            }
          },
        }
      },
    } as unknown as D1Database
    sqlite.exec(`
      INSERT INTO users (id,email,name,created_at,last_signin_at)
      VALUES
        ('snapshot-author','author@example.test','Author',1,1),
        ('snapshot-watcher','watcher@example.test','Watcher',1,1);
      INSERT INTO teams
        (id,workos_organization_id,name,created_by_user_id,created_at,updated_at)
      VALUES ('team_snapshot','org_snapshot','Paperboy','snapshot-author',1,1);
      INSERT INTO team_memberships
        (team_id,user_id,role,joined_at,updated_at)
      VALUES
        ('team_snapshot','snapshot-author','owner',1,1),
        ('team_snapshot','snapshot-watcher','member',1,1);
      INSERT INTO handles (handle,user_id,team_id,claimed_at,released_at)
      VALUES
        ('paperboy',NULL,'team_snapshot',1,NULL),
        ('author','snapshot-author',NULL,1,NULL),
        ('watcher','snapshot-watcher',NULL,1,NULL);
      INSERT INTO projects
        (id,owner_user_id,owner_team_id,slug,name,description,github_url,
         created_by_user_id,created_at,updated_at,archived_at)
      VALUES
        ('project_team_snapshot_public',NULL,'team_snapshot','react-vapor',
         'React Vapor','Compiler research',NULL,'snapshot-author',1,1,NULL);
      INSERT INTO hub_sessions
        (sid,owner_user_id,root,record_count,visibility,team_id,project_id,
         withdrawn_at,created_at,updated_at)
      VALUES
        ('codex_snapshot-public','snapshot-author','root',1,'unlisted',
         'team_snapshot','project_team_snapshot_public',NULL,1,2);
      INSERT INTO hub_session_discovery
        (sid,agent,title,summary_text,search_text,message_count,tool_call_count,
         file_count,additions,deletions,lineage_source_sid,quality_score,published_at,updated_at)
      VALUES
        ('codex_snapshot-public','codex','Snapshot','Summary','snapshot',1,1,0,0,0,
         NULL,1,2,2);
      INSERT INTO project_watches (project_id,user_id,created_at)
      VALUES ('project_team_snapshot_public','snapshot-watcher',2);
    `)
    const stalePublicTarget = {
      projectId: 'project_team_snapshot_public',
      ownerUserId: null,
      ownerTeamId: 'team_snapshot',
      ownerHandle: 'paperboy',
      slug: 'react-vapor',
      isPublic: true,
      hasLivePublicSession: true,
    }

    await expect(getProjectSocialSnapshot(db, stalePublicTarget, null)).resolves.toMatchObject({
      isPublic: true,
      state: {
        starEligible: true,
        watcherCount: 1,
      },
    })
    await expect(
      listProjectStargazers(db, stalePublicTarget, {
        after: null,
        fingerprint: 'smoke',
        limit: 30,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null })
    await expect(
      listPublicProjectSessions(db, 'paperboy', 'react-vapor', {
        after: null,
        fingerprint: 'smoke',
        limit: 20,
      }),
    ).resolves.toMatchObject({
      owner: { kind: 'team', id: 'team_snapshot', handle: 'paperboy' },
      project: {
        id: 'project_team_snapshot_public',
        session_count: 1,
      },
      rows: [{ sid: 'codex_snapshot-public' }],
      nextCursor: null,
    })

    // Leave the private Watch row behind to model the worst interleaving: an
    // earlier resolver observed Public, then the final projection disappeared
    // before response authorization/data were read.
    sqlite.exec("UPDATE hub_sessions SET withdrawn_at=3 WHERE sid='codex_snapshot-public';")
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM project_watches WHERE project_id='project_team_snapshot_public'",
        )
        .get(),
    ).toMatchObject({ count: 1 })

    await expect(getProjectSocialSnapshot(db, stalePublicTarget, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(
      getProjectSocialSnapshot(db, stalePublicTarget, 'snapshot-watcher'),
    ).resolves.toMatchObject({
      isPublic: false,
      state: {
        starEligible: false,
        watcherCount: 1,
        viewerWatching: true,
        canWatch: true,
      },
    })
    await expect(
      listProjectStargazers(db, stalePublicTarget, {
        after: null,
        fingerprint: 'smoke',
        limit: 30,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      listPublicProjectSessions(db, 'paperboy', 'react-vapor', {
        after: null,
        fingerprint: 'smoke',
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  } finally {
    sqlite.close()
  }
})
