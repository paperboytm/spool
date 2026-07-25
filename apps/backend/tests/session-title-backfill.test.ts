import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vite-plus/test'

// The production utility is intentionally plain ESM so it can run directly
// under a pinned Node 22 binary without a build step.
// @ts-expect-error The checked-in operational script deliberately has no TS build artifact.
import * as backfill from '../scripts/backfill-session-titles.mjs'

const {
  TARGET,
  buildMutationSql,
  noteSha256,
  validateMapping,
  validateSnapshotAgainstMapping,
  verifyPostState,
} = backfill

type Projection = {
  additions: number
  agent: 'claude' | 'codex'
  costUsd: number | null
  deletions: number
  fileCount: number
  lineageSourceSid: string | null
  messageCount: number
  publishedAt: number
  qualityScore: number
  searchText: string
  summaryText: string | null
  title: string
  titleJson: string | null
  toolCallCount: number
  totalTokens: number | null
  updatedAt: number
}

type SnapshotRow = {
  noteMd: string | null
  projection: Projection | null
  root: string
  sid: string
  teamId: string | null
  updatedAt: number
  visibility: 'private' | 'unlisted'
  withdrawnAt: null
}

function projection(index: number): Projection {
  const agent = index % 2 === 0 ? 'claude' : 'codex'
  return {
    additions: index,
    agent,
    costUsd: index === 0 ? 1.25 : null,
    deletions: index + 1,
    fileCount: index + 2,
    lineageSourceSid: null,
    messageCount: index + 3,
    publishedAt: 1_700_000_000_000 + index,
    qualityScore: 12,
    searchText: `old title ${index} old summary ${index} ${agent}`,
    summaryText: `Old summary ${index}`,
    title: `Old title ${index}`,
    titleJson: null,
    toolCallCount: index + 4,
    totalTokens: index === 0 ? 123 : null,
    updatedAt: 1_700_000_100_000 + index,
  }
}

function fixture() {
  const rows: SnapshotRow[] = []
  const sessions = []

  for (let index = 0; index < 9; index += 1) {
    const isTeam = index === 8
    const isLinkOnly = index === 7
    const hasProjection = !isTeam && !isLinkOnly
    const sid =
      index === 7
        ? `pi_00000000-0000-4000-8000-00000000000${index}`
        : `${index % 2 === 0 ? 'claude' : 'codex'}_00000000-0000-4000-8000-00000000000${index}`
    const oldNote = index === 7 ? null : `# Old summary ${index}\n\nPrivate preimage ${index}.`
    const currentProjection = hasProjection ? projection(index) : null
    const visibility = isTeam ? 'private' : 'unlisted'
    const teamId = isTeam ? 'team_12345678' : null
    const root = createHash('sha256').update(`root-${index}`).digest('hex')
    const updatedAt = 1_700_000_100_000 + index

    rows.push({
      noteMd: oldNote,
      projection: currentProjection,
      root,
      sid,
      teamId,
      updatedAt,
      visibility,
      withdrawnAt: null,
    })

    const en = `Deliver reviewed outcome number ${index}`
    const zh = `交付已审阅成果 ${index}`
    const summaryBodyMd = `# Outcome ${index}\n\nCompleted the reviewed work item ${index}.`
    const summaryText = `Outcome ${index} Completed the reviewed work item ${index}.`
    sessions.push({
      sid,
      expected: {
        root,
        updatedAt,
        visibility,
        teamId,
        withdrawnAt: null,
        noteMd: oldNote,
        noteSha256: noteSha256(oldNote),
        projection: currentProjection,
      },
      replacement: {
        titles: { en, zh },
        summaryBodyMd,
        projection: hasProjection
          ? {
              qualityScore: 18,
              searchText: `${en} ${zh} ${summaryText} retained prompt ${index}`.toLowerCase(),
            }
          : null,
      },
    })
  }

  return {
    mapping: {
      version: 1,
      target: { ...TARGET },
      sessions,
    },
    rows,
  }
}

describe('production Session title backfill utility', () => {
  it('validates all exact preimages without exposing or weakening the fixed 9/7/1/1 scope', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)

    expect(validateSnapshotAgainstMapping(rows, mapping)).toEqual({
      public: 7,
      linkOnly: 1,
      team: 1,
    })
    expect(mapping.sessions).toHaveLength(9)
    expect(mapping.sessions.filter((entry: any) => entry.next.projection !== null)).toHaveLength(7)
  })

  it('rejects note and projection drift using full preimages', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)
    const noteDrift = structuredClone(rows)
    noteDrift[0]!.noteMd = 'sensitive changed body'

    expect(() => validateSnapshotAgainstMapping(noteDrift, mapping)).toThrow(
      /Session note preimage drifted/,
    )

    const projectionDrift = structuredClone(rows)
    projectionDrift[0]!.projection!.fileCount += 1
    expect(() => validateSnapshotAgainstMapping(projectionDrift, mapping)).toThrow(
      /Projection preimage\.fileCount drifted/,
    )
  })

  it('generates one guarded atomic-file plan with exact CAS updates and no updated_at mutation', () => {
    const { mapping: rawMapping } = fixture()
    const mapping = validateMapping(rawMapping)
    const sql = buildMutationSql(mapping, 'apply', {
      mappingSha256: 'a'.repeat(64),
      backupSha256: 'b'.repeat(64),
    })

    expect(sql.match(/UPDATE hub_sessions/g)).toHaveLength(9)
    expect(sql.match(/UPDATE hub_session_discovery/g)).toHaveLength(7)
    expect(sql.match(/changes\(\) = 1/g)).toHaveLength(16)
    expect(sql.match(/json_extract\('spool-cas-guard'/g)).toHaveLength(18)
    expect(sql.match(/json_extract\('spool-inventory-guard'/g)).toHaveLength(2)
    expect(sql).toContain('Exact live inventory guard (before apply)')
    expect(sql).toContain('Exact live inventory guard (after apply)')
    expect(
      sql.match(/SELECT COUNT\(\*\) FROM hub_sessions WHERE withdrawn_at IS NULL/g),
    ).toHaveLength(2)
    expect(sql.match(/FROM hub_session_discovery projection/g)).toHaveLength(2)
    for (const session of mapping.sessions) {
      expect(sql).toContain(`'${session.sid}'`)
    }
    expect(sql).toContain('SET note_md =')
    expect(sql).toContain('updated_at IS')
    expect(sql).not.toMatch(/SET[\s\S]{0,20}updated_at\s*=/)
    expect(sql).toContain("note_md IS '# Old summary 0")
  })

  it('rolls the whole import back when the live Session set changes after preflight', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)

    for (const direction of ['apply', 'rollback'] as const) {
      const db = new DatabaseSync(':memory:')
      try {
        db.exec(`
          CREATE TABLE hub_sessions (
            sid TEXT PRIMARY KEY,
            root TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            visibility TEXT NOT NULL,
            team_id TEXT,
            withdrawn_at INTEGER,
            note_md TEXT
          );
          CREATE TABLE hub_session_discovery (
            sid TEXT PRIMARY KEY,
            additions INTEGER NOT NULL,
            agent TEXT NOT NULL,
            cost_usd REAL,
            deletions INTEGER NOT NULL,
            file_count INTEGER NOT NULL,
            lineage_source_sid TEXT,
            message_count INTEGER NOT NULL,
            published_at INTEGER NOT NULL,
            quality_score INTEGER NOT NULL,
            search_text TEXT NOT NULL,
            summary_text TEXT,
            title TEXT NOT NULL,
            title_json TEXT,
            tool_call_count INTEGER NOT NULL,
            total_tokens INTEGER,
            updated_at INTEGER NOT NULL
          );
        `)
        const insertSession = db.prepare(
          `INSERT INTO hub_sessions
             (sid,root,updated_at,visibility,team_id,withdrawn_at,note_md)
           VALUES (?,?,?,?,?,?,?)`,
        )
        const insertProjection = db.prepare(
          `INSERT INTO hub_session_discovery
             (sid,additions,agent,cost_usd,deletions,file_count,lineage_source_sid,
              message_count,published_at,quality_score,search_text,summary_text,title,
              title_json,tool_call_count,total_tokens,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        for (const row of rows) {
          insertSession.run(
            row.sid,
            row.root,
            row.updatedAt,
            row.visibility,
            row.teamId,
            row.withdrawnAt,
            row.noteMd,
          )
          if (row.projection !== null) {
            const projection = row.projection
            insertProjection.run(
              row.sid,
              projection.additions,
              projection.agent,
              projection.costUsd,
              projection.deletions,
              projection.fileCount,
              projection.lineageSourceSid,
              projection.messageCount,
              projection.publishedAt,
              projection.qualityScore,
              projection.searchText,
              projection.summaryText,
              projection.title,
              projection.titleJson,
              projection.toolCallCount,
              projection.totalTokens,
              projection.updatedAt,
            )
          }
        }

        // Simulate a new Share committing after the reviewed snapshot but
        // before the remote file import starts.
        insertSession.run(
          'codex_00000000-0000-4000-8000-000000000099',
          'f'.repeat(64),
          1_700_000_200_000,
          'unlisted',
          null,
          null,
          '# Newly shared Session',
        )
        const before = db
          .prepare('SELECT sid,note_md FROM hub_sessions ORDER BY sid')
          .all() as Array<{ sid: string; note_md: string | null }>

        db.exec('BEGIN IMMEDIATE')
        expect(() => db.exec(buildMutationSql(mapping, direction))).toThrow()
        db.exec('ROLLBACK')

        expect(db.prepare('SELECT sid,note_md FROM hub_sessions ORDER BY sid').all()).toEqual(
          before,
        )
      } finally {
        db.close()
      }
    }
  })

  it('generates a reverse CAS plan and verifies the exact bilingual post-state', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)
    const after = structuredClone(rows)
    const afterBySid = new Map(after.map((row) => [row.sid, row]))
    for (const entry of mapping.sessions) {
      const row = afterBySid.get(entry.sid)!
      row.noteMd = entry.next.noteMd
      row.projection = entry.next.projection
    }

    expect(verifyPostState(after, mapping)).toEqual({
      bilingualTitles: 9,
      projections: 7,
      scopes: { public: 7, linkOnly: 1, team: 1 },
      summaries: 9,
    })

    const rollback = buildMutationSql(mapping, 'rollback')
    expect(rollback).toContain("SET note_md = '# Old summary 0")
    expect(rollback).toContain('title_json = NULL')
    expect(rollback.match(/changes\(\) = 1/g)).toHaveLength(16)
    expect(rollback.match(/json_extract\('spool-inventory-guard'/g)).toHaveLength(2)
    expect(rollback).toContain('Exact live inventory guard (before rollback)')
    expect(rollback).toContain('Exact live inventory guard (after rollback)')
  })
})
