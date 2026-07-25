import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vite-plus/test'

// The production utility is intentionally plain ESM so it can run directly
// under a pinned Node 22 binary without a build step.
// @ts-expect-error The checked-in operational script deliberately has no TS build artifact.
import * as backfill from '../scripts/backfill-session-titles.mjs'

const {
  TARGET,
  buildArtifactMetadata,
  buildMutationSql,
  noteSha256,
  parseArgs,
  readPrivateMapping,
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
  summaryTextZh: string | null
  title: string
  titleJson: string | null
  toolCallCount: number
  totalTokens: number | null
  updatedAt: number
}

type GuidanceRow = {
  generatedAt: number
  guidanceJson: string
  root: string
}

type SnapshotRow = {
  costUsd: number | null
  guidance: GuidanceRow | null
  noteMd: string | null
  projection: Projection | null
  recordCount: number
  root: string
  sid: string
  teamId: string | null
  totalTokens: number | null
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
    summaryTextZh: null,
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
    const currentCostUsd = currentProjection?.costUsd ?? null
    const currentTotalTokens = currentProjection?.totalTokens ?? null
    const visibility = isTeam ? 'private' : 'unlisted'
    const teamId = isTeam ? 'team_12345678' : null
    const root = createHash('sha256').update(`root-${index}`).digest('hex')
    const updatedAt = 1_700_000_100_000 + index

    rows.push({
      noteMd: oldNote,
      costUsd: currentCostUsd,
      guidance: null,
      projection: currentProjection,
      recordCount: 20,
      root,
      sid,
      teamId,
      totalTokens: currentTotalTokens,
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
        costUsd: currentCostUsd,
        guidance: null,
        root,
        recordCount: 20,
        updatedAt,
        visibility,
        teamId,
        withdrawnAt: null,
        noteMd: oldNote,
        noteSha256: noteSha256(oldNote),
        projection: currentProjection,
        totalTokens: currentTotalTokens,
      },
      replacement: {
        titles: { en, zh },
        summaries: {
          enMd: summaryBodyMd,
          zhMd: `# 成果 ${index}\n\n完成了已审阅的工作项 ${index}。`,
        },
        usage: {
          records: 1,
          models: {
            'claude-sonnet-4-5-20250929': {
              input: 100 + index,
              output: 20,
              cacheRead: 30,
              cacheWrite: 10,
            },
          },
        },
        cost: {
          usd: 0.01 + index / 100,
          totalTokens: 160 + index,
        },
        guidance: {
          generatedAt: 1_700_000_200_000 + index,
          value: {
            v: 1,
            turns: [
              {
                promptRecord: 0,
                replyRecords: [1, 2],
                replyChars: 120 + index,
                toolCalls: 1,
              },
            ],
          },
        },
        projection: hasProjection
          ? {
              qualityScore: 18,
              searchText: (
                `${en} ${zh} ${summaryText} 成果 ${index} 完成了已审阅的工作项 ${index}。 ` +
                `retained prompt ${index}`
              ).toLowerCase(),
            }
          : null,
      },
    })
  }

  return {
    mapping: {
      version: 2,
      target: { ...TARGET },
      sessions,
    },
    rows,
  }
}

function localDatabase(rows: SnapshotRow[]): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE hub_sessions (
      sid TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      visibility TEXT NOT NULL,
      team_id TEXT,
      withdrawn_at INTEGER,
      note_md TEXT,
      cost_usd REAL,
      total_tokens INTEGER
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
      summary_text_zh TEXT,
      title TEXT NOT NULL,
      title_json TEXT,
      tool_call_count INTEGER NOT NULL,
      total_tokens INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE hub_session_guidance (
      sid TEXT PRIMARY KEY REFERENCES hub_sessions(sid) ON DELETE CASCADE,
      root TEXT NOT NULL,
      guidance_json TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );
  `)
  const insertSession = db.prepare(
    `INSERT INTO hub_sessions
       (sid,root,record_count,updated_at,visibility,team_id,withdrawn_at,note_md,cost_usd,total_tokens)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const insertProjection = db.prepare(
    `INSERT INTO hub_session_discovery
       (sid,additions,agent,cost_usd,deletions,file_count,lineage_source_sid,
        message_count,published_at,quality_score,search_text,summary_text,summary_text_zh,title,
        title_json,tool_call_count,total_tokens,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insertGuidance = db.prepare(
    `INSERT INTO hub_session_guidance (sid,root,guidance_json,generated_at)
     VALUES (?,?,?,?)`,
  )
  for (const row of rows) {
    insertSession.run(
      row.sid,
      row.root,
      row.recordCount,
      row.updatedAt,
      row.visibility,
      row.teamId,
      row.withdrawnAt,
      row.noteMd,
      row.costUsd,
      row.totalTokens,
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
        projection.summaryTextZh,
        projection.title,
        projection.titleJson,
        projection.toolCallCount,
        projection.totalTokens,
        projection.updatedAt,
      )
    }
    if (row.guidance !== null) {
      insertGuidance.run(
        row.sid,
        row.guidance.root,
        row.guidance.guidanceJson,
        row.guidance.generatedAt,
      )
    }
  }
  return db
}

describe('production Session title backfill utility', () => {
  it('keeps dry-run and verify read-only while gating both mutation modes by mapping SHA', () => {
    expect(parseArgs(['--mapping', '/private/mapping.json'])).toMatchObject({
      mode: 'dry-run',
    })
    expect(parseArgs(['--mapping', '/private/mapping.json', '--verify'])).toMatchObject({
      mode: 'verify',
    })
    expect(() => parseArgs(['--mapping', '/private/mapping.json', '--apply'])).toThrow(
      /--apply requires --mapping-sha/,
    )
    expect(() => parseArgs(['--mapping', '/private/mapping.json', '--rollback'])).toThrow(
      /--rollback requires --mapping-sha/,
    )
    expect(
      parseArgs([
        '--mapping',
        '/private/mapping.json',
        '--rollback',
        '--mapping-sha',
        'a'.repeat(64),
      ]),
    ).toMatchObject({ mode: 'rollback' })
  })

  it('accepts a mode-0600 reviewed mapping only from outside the repository', async () => {
    const { mapping } = fixture()
    const directory = await mkdtemp(join(tmpdir(), 'spool-backfill-mapping-test-'))
    try {
      const path = join(directory, 'mapping.json')
      const bytes = `${JSON.stringify(mapping)}\n`
      await writeFile(path, bytes, { mode: 0o600 })

      const loaded = await readPrivateMapping(path)

      expect(loaded.mapping.version).toBe(2)
      expect(loaded.mapping.sessions).toHaveLength(9)
      expect(loaded.mappingSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

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

  it('rejects inconsistent usage/cost, invalid guidance ranges, and reserved delimiters', () => {
    const { mapping } = fixture()

    const badCost = structuredClone(mapping)
    badCost.sessions[0]!.replacement.cost.totalTokens += 1
    expect(() => validateMapping(badCost)).toThrow(/must equal the non-zero usage token total/)

    const badGuidance = structuredClone(mapping)
    badGuidance.sessions[0]!.replacement.guidance.value.turns[0]!.replyRecords = [20]
    expect(() => validateMapping(badGuidance)).toThrow(/replyRecords are out of order or range/)

    const oversizedGuidance = structuredClone(mapping)
    oversizedGuidance.sessions[0]!.replacement.guidance.value.turns = Array.from(
      { length: 2_049 },
      (_, promptRecord) => ({
        promptRecord,
        replyChars: 0,
        replyRecords: [],
        toolCalls: 0,
      }),
    )
    expect(() => validateMapping(oversizedGuidance)).toThrow(/at most 2048 entries/)

    const badSummary = structuredClone(mapping)
    badSummary.sessions[0]!.replacement.summaries.enMd = 'Background\n<!-- /spool:summary -->'
    expect(() => validateMapping(badSummary)).toThrow(/reserved Summary delimiters/)
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
    expect(sql.match(/INSERT INTO hub_session_guidance/g)).toHaveLength(9)
    expect(sql.match(/changes\(\) = 1/g)).toHaveLength(25)
    expect(sql.match(/json_extract\('spool-cas-guard'/g)).toHaveLength(27)
    expect(sql.match(/json_extract\('spool-inventory-guard'/g)).toHaveLength(2)
    expect(sql).toContain('Exact live inventory guard (before apply)')
    expect(sql).toContain('Exact live inventory guard (after apply)')
    expect(
      sql.match(/SELECT COUNT\(\*\) FROM hub_sessions WHERE withdrawn_at IS NULL/g),
    ).toHaveLength(2)
    expect(sql.match(/FROM hub_session_discovery projection/g)).toHaveLength(2)
    expect(sql.match(/FROM hub_session_guidance guidance/g)).toHaveLength(4)
    for (const session of mapping.sessions) {
      expect(sql).toContain(`'${session.sid}'`)
    }
    expect(sql).toContain('SET note_md =')
    expect(sql).toContain('summary_text_zh =')
    expect(sql).toContain('cost_usd =')
    expect(sql).toContain('total_tokens =')
    expect(sql).toContain('updated_at IS')
    expect(sql).not.toMatch(/SET[\s\S]{0,20}updated_at\s*=/)
    expect(sql).toContain("note_md IS '# Old summary 0")
  })

  it('builds dry-run artifact metadata without dereferencing a deferred backup', () => {
    expect(
      buildArtifactMetadata({
        applySha256: 'a'.repeat(64),
        backupSha256: null,
        mappingSha256: 'b'.repeat(64),
        rollbackSha256: 'c'.repeat(64),
      }),
    ).toEqual({
      applySha256: 'a'.repeat(64),
      mappingSha256: 'b'.repeat(64),
      rollbackSha256: 'c'.repeat(64),
    })
  })

  it('rolls the whole import back when the live Session set changes after preflight', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)

    for (const direction of ['apply', 'rollback'] as const) {
      const db = localDatabase(rows)
      try {
        if (direction === 'rollback') db.exec(buildMutationSql(mapping, 'apply'))
        const insertSession = db.prepare(
          `INSERT INTO hub_sessions
             (sid,root,record_count,updated_at,visibility,team_id,withdrawn_at,note_md,
              cost_usd,total_tokens)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )

        // Simulate a new Share committing after the reviewed snapshot but
        // before the remote file import starts.
        insertSession.run(
          'codex_00000000-0000-4000-8000-000000000099',
          'f'.repeat(64),
          1,
          1_700_000_200_000,
          'unlisted',
          null,
          null,
          '# Newly shared Session',
          null,
          null,
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

  it('applies and rolls back the complete local metadata fixture without losing preimages', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)
    const db = localDatabase(rows)
    try {
      const snapshot = () => ({
        guidance: db.prepare('SELECT * FROM hub_session_guidance ORDER BY sid').all(),
        projections: db.prepare('SELECT * FROM hub_session_discovery ORDER BY sid').all(),
        sessions: db.prepare('SELECT * FROM hub_sessions ORDER BY sid').all(),
      })
      const before = snapshot()

      db.exec('BEGIN IMMEDIATE')
      db.exec(buildMutationSql(mapping, 'apply'))
      db.exec('COMMIT')

      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM hub_sessions
           WHERE note_md LIKE '%<!-- spool:summary:en -->%'
             AND note_md LIKE '%<!-- spool:summary:zh -->%'
             AND total_tokens IS NOT NULL`,
          )
          .get(),
      ).toEqual({ count: 9 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM hub_session_guidance').get()).toEqual({
        count: 9,
      })
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM hub_session_discovery WHERE summary_text_zh IS NOT NULL',
          )
          .get(),
      ).toEqual({ count: 7 })

      db.exec('BEGIN IMMEDIATE')
      db.exec(buildMutationSql(mapping, 'rollback'))
      db.exec('COMMIT')

      expect(snapshot()).toEqual(before)
    } finally {
      db.close()
    }
  })

  it('generates a reverse CAS plan and verifies the exact bilingual post-state', () => {
    const { mapping: rawMapping, rows } = fixture()
    const mapping = validateMapping(rawMapping)
    const after = structuredClone(rows)
    const afterBySid = new Map(after.map((row) => [row.sid, row]))
    for (const entry of mapping.sessions) {
      const row = afterBySid.get(entry.sid)!
      row.costUsd = entry.next.cost?.usd ?? null
      row.guidance = {
        generatedAt: entry.next.guidance.generatedAt,
        guidanceJson: entry.next.guidance.guidanceJson,
        root: entry.next.guidance.root,
      }
      row.noteMd = entry.next.noteMd
      row.projection = entry.next.projection
      row.totalTokens = entry.next.cost?.totalTokens ?? null
    }

    expect(verifyPostState(after, mapping)).toEqual({
      bilingualSummaries: 9,
      bilingualTitles: 9,
      costs: 9,
      guidance: 9,
      projections: 7,
      scopes: { public: 7, linkOnly: 1, team: 1 },
      usage: 9,
    })

    const rollback = buildMutationSql(mapping, 'rollback')
    expect(rollback).toContain("SET note_md = '# Old summary 0")
    expect(rollback).toContain('title_json = NULL')
    expect(rollback.match(/DELETE FROM hub_session_guidance/g)).toHaveLength(9)
    expect(rollback.match(/changes\(\) = 1/g)).toHaveLength(25)
    expect(rollback.match(/json_extract\('spool-inventory-guard'/g)).toHaveLength(2)
    expect(rollback).toContain('Exact live inventory guard (before rollback)')
    expect(rollback).toContain('Exact live inventory guard (after rollback)')
  })
})
