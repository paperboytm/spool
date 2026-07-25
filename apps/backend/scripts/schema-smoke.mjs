import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { incrementQualifiedReadIfLive, listDiscoveryPage } from '../src/discovery/store.ts'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationsDir = join(appDir, 'migrations')
const migrationNames = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

if (migrationNames.length === 0) {
  throw new Error(`No SQL migrations found in ${migrationsDir}`)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, ['exec', 'wrangler', ...args], {
      cwd: appDir,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stderr, stdout })
        return
      }

      reject(
        new Error(`wrangler ${args.join(' ')} failed with exit code ${code}\n${stdout}${stderr}`),
      )
    })
  })
}

async function executeJson(stateDir, command) {
  const { stdout } = await runWrangler([
    'd1',
    'execute',
    'spool-share-db',
    '--local',
    '--persist-to',
    stateDir,
    '--config',
    'wrangler.toml',
    '--command',
    command,
    '--json',
  ])
  const payload = JSON.parse(stdout)
  if (!Array.isArray(payload)) {
    throw new TypeError('Wrangler returned an unexpected D1 JSON payload')
  }
  return payload.flatMap((execution) => execution.results ?? [])
}

async function expectD1Failure(stateDir, command, expectedMessage) {
  try {
    await executeJson(stateDir, command)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedMessage)) {
      throw new Error(`Expected D1 failure containing ${expectedMessage}, received:\n${message}`)
    }
    return
  }
  throw new Error(`Expected D1 command to fail: ${command}`)
}

async function discoverySql(options) {
  let captured = null
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              captured = { params, sql }
              return { results: [] }
            },
          }
        },
      }
    },
  }
  await listDiscoveryPage(db, options)
  if (captured === null) throw new Error('Discovery query was not prepared')

  let parameterIndex = 0
  const sql = captured.sql.replaceAll('?', () => {
    if (parameterIndex >= captured.params.length) {
      throw new Error('Discovery SQL has more placeholders than bound parameters')
    }
    return sqlLiteral(captured.params[parameterIndex++])
  })
  if (parameterIndex !== captured.params.length) {
    throw new Error('Discovery SQL has fewer placeholders than bound parameters')
  }
  return sql
}

async function engagementSql(sid, day) {
  let captured = null
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              captured = { params, sql }
              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
  }
  await incrementQualifiedReadIfLive(db, sid, day)
  if (captured === null) throw new Error('Discovery engagement query was not prepared')

  let parameterIndex = 0
  const sql = captured.sql.replaceAll('?', () => {
    if (parameterIndex >= captured.params.length) {
      throw new Error('Discovery engagement SQL has more placeholders than bound parameters')
    }
    return sqlLiteral(captured.params[parameterIndex++])
  })
  if (parameterIndex !== captured.params.length) {
    throw new Error('Discovery engagement SQL has fewer placeholders than bound parameters')
  }
  return sql
}

function sqlLiteral(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot bind a non-finite SQL number')
    return String(value)
  }
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  throw new Error(`Unsupported discovery SQL binding: ${typeof value}`)
}

const stateDir = await mkdtemp(join(tmpdir(), 'spool-d1-schema-smoke-'))

try {
  await runWrangler([
    'd1',
    'migrations',
    'apply',
    'spool-share-db',
    '--local',
    '--persist-to',
    stateDir,
    '--config',
    'wrangler.toml',
  ])

  const migrationRows = await executeJson(stateDir, 'SELECT name FROM d1_migrations ORDER BY id;')
  const appliedNames = migrationRows.map((row) => row.name)
  if (JSON.stringify(appliedNames) !== JSON.stringify(migrationNames)) {
    throw new Error(
      `Applied migration ledger does not match disk.\nExpected: ${migrationNames.join(', ')}\nActual: ${appliedNames.join(', ')}`,
    )
  }

  const foreignKeyViolations = await executeJson(stateDir, 'PRAGMA foreign_key_check;')
  if (foreignKeyViolations.length !== 0) {
    throw new Error(
      `PRAGMA foreign_key_check found violations:\n${JSON.stringify(foreignKeyViolations, null, 2)}`,
    )
  }

  const membershipColumns = await executeJson(stateDir, 'PRAGMA table_info(team_memberships);')
  if (!membershipColumns.some((column) => column.name === 'workos_updated_at')) {
    throw new Error('team_memberships.workos_updated_at was not migrated')
  }
  const durabilityTables = await executeJson(
    stateDir,
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workos_webhook_events','workos_cleanup_outbox','workos_membership_denials','workos_user_denials','team_creation_requests','team_invitation_requests') ORDER BY name;",
  )
  if (durabilityTables.length !== 6) {
    throw new Error(`Missing WorkOS durability tables: ${JSON.stringify(durabilityTables)}`)
  }
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES ('durable-user','durable@example.test',1,1);
     INSERT INTO teams (id,workos_organization_id,name,created_by_user_id,created_at,updated_at)
       VALUES ('team_durable','org_durable','Durable','durable-user',1,1);
     INSERT INTO team_memberships
       (team_id,user_id,role,workos_membership_id,workos_updated_at,joined_at,updated_at)
       VALUES ('team_durable','durable-user','owner','om_durable',1,1,1);
     INSERT INTO workos_webhook_events
       (event_id,event_type,event_created_at,received_at,processed_at)
       VALUES ('event_durable','organization_membership.updated',1,1,1);
     INSERT INTO workos_cleanup_outbox
       (id,operation,resource_id,team_id,user_id,next_attempt_at,created_at,updated_at)
       VALUES ('woc_durable','membership.delete','om_durable','team_durable','durable-user',1,1,1);
     INSERT INTO team_creation_requests
       (user_id,idempotency_key,team_id,normalized_name,status,workos_organization_id,created_at,updated_at)
       VALUES ('durable-user','create_durable_0001','team_durable','Durable','completed','org_durable',1,1);
     INSERT INTO team_invitation_requests
       (team_id,invited_by_user_id,idempotency_key,invitation_id,normalized_email,desired_role,status,workos_invitation_id,created_at,updated_at)
       VALUES ('team_durable','durable-user','invite_durable_0001','tinv_durable','invitee@example.test','member','completed','inv_durable',1,1);
     INSERT INTO workos_membership_denials
       (organization_id,membership_id,workos_user_id,reason,workos_updated_at,team_id,user_id,previous_role,denied_at,event_id)
       VALUES ('org_denied','om_denied','workos_denied','inactive',1,NULL,NULL,NULL,1,'event_denied');
     INSERT INTO workos_user_denials (workos_user_id,denied_at,event_id)
       VALUES ('workos_deleted',1,'event_user_deleted');`,
  )

  const discoveryIndexes = await executeJson(
    stateDir,
    "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('hub_discovery_agent_published_sid','hub_discovery_published_sid') ORDER BY name;",
  )
  if (discoveryIndexes.length !== 2) {
    throw new Error(`Missing Discovery keyset indexes: ${JSON.stringify(discoveryIndexes)}`)
  }
  const socialSchema = await executeJson(
    stateDir,
    "SELECT type,name FROM sqlite_master WHERE (type='table' AND name IN ('hub_session_stars','hub_session_resume_grants','hub_session_verified_forks')) OR (type='index' AND name IN ('hub_session_stars_user_created','hub_discovery_lineage_source_sid','hub_resume_grants_source_expires','hub_resume_grants_unclaimed_expires','hub_verified_forks_source_verified')) ORDER BY type,name;",
  )
  if (
    JSON.stringify(socialSchema) !==
    JSON.stringify([
      { type: 'index', name: 'hub_discovery_lineage_source_sid' },
      { type: 'index', name: 'hub_resume_grants_source_expires' },
      { type: 'index', name: 'hub_resume_grants_unclaimed_expires' },
      { type: 'index', name: 'hub_session_stars_user_created' },
      { type: 'index', name: 'hub_verified_forks_source_verified' },
      { type: 'table', name: 'hub_session_resume_grants' },
      { type: 'table', name: 'hub_session_stars' },
      { type: 'table', name: 'hub_session_verified_forks' },
    ])
  ) {
    throw new Error(`Missing Session social schema: ${JSON.stringify(socialSchema)}`)
  }
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES ('social-viewer','social-viewer@example.test',1,1);
     INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,created_at,updated_at)
       VALUES (
         'codex_00000000-0000-4000-8000-000000000099',
         'durable-user',
         '${'c'.repeat(64)}',
         1,
         'unlisted',
         1,
         1
       );
     INSERT INTO hub_session_stars (sid,user_id,created_at)
       VALUES ('codex_00000000-0000-4000-8000-000000000099','social-viewer',1);
     INSERT OR IGNORE INTO hub_session_stars (sid,user_id,created_at)
       VALUES ('codex_00000000-0000-4000-8000-000000000099','social-viewer',2);`,
  )
  const idempotentStars = await executeJson(
    stateDir,
    "SELECT COUNT(*) AS count FROM hub_session_stars WHERE sid='codex_00000000-0000-4000-8000-000000000099';",
  )
  if (idempotentStars[0]?.count !== 1) {
    throw new Error(`Session stars are not idempotent: ${JSON.stringify(idempotentStars)}`)
  }
  await executeJson(
    stateDir,
    "DELETE FROM hub_sessions WHERE sid='codex_00000000-0000-4000-8000-000000000099';",
  )
  const cascadedStars = await executeJson(
    stateDir,
    "SELECT COUNT(*) AS count FROM hub_session_stars WHERE sid='codex_00000000-0000-4000-8000-000000000099';",
  )
  if (cascadedStars[0]?.count !== 0) {
    throw new Error(`Session star target cascade failed: ${JSON.stringify(cascadedStars)}`)
  }
  await executeJson(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,created_at,updated_at)
       VALUES (
         'claude_00000000-0000-4000-8000-000000000001',
         'durable-user',
         '${'a'.repeat(64)}',
         12,
         'unlisted',
         1,
         1
       );
     INSERT INTO hub_session_discovery
       (sid,agent,title,summary_text,search_text,message_count,tool_call_count,file_count,
        additions,deletions,quality_score,published_at,updated_at)
       VALUES (
         'claude_00000000-0000-4000-8000-000000000001',
         'claude',
         'Durable result',
         'A durable discovery result.',
         'durable result claude',
         2,
         1,
         1,
         4,
         0,
         20,
         1,
         1
       );
     INSERT INTO hub_session_engagement_daily (sid,day,qualified_reads)
       VALUES ('claude_00000000-0000-4000-8000-000000000001','1970-01-01',5);
     INSERT INTO handles (handle,user_id,claimed_at,released_at)
       VALUES
         ('zeta-durable','durable-user',1,NULL),
         ('alpha-durable','durable-user',2,NULL);`,
  )
  await executeJson(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,created_at,updated_at)
       VALUES (
         'codex_00000000-0000-4000-8000-000000000098',
         'durable-user',
         '${'b'.repeat(64)}',
         2,
         'unlisted',
         2,
         2
       );
     INSERT INTO hub_session_resume_grants
       (token_hash,source_sid,source_root,source_position,created_at,expires_at,
        claimed_child_sid,claimed_child_root,claimed_at)
       VALUES (
         '${'d'.repeat(64)}',
         'claude_00000000-0000-4000-8000-000000000001',
         '${'a'.repeat(64)}',
         2,
         1,
         100,
         'codex_00000000-0000-4000-8000-000000000098',
         '${'b'.repeat(64)}',
         2
       );
     INSERT INTO hub_session_verified_forks
       (child_sid,source_sid,source_root,source_position,child_root,
        grant_token_hash,verified_at)
       VALUES (
         'codex_00000000-0000-4000-8000-000000000098',
         'claude_00000000-0000-4000-8000-000000000001',
         '${'a'.repeat(64)}',
         2,
         '${'b'.repeat(64)}',
         '${'d'.repeat(64)}',
         2
       );`,
  )
  await expectD1Failure(
    stateDir,
    `INSERT INTO hub_session_verified_forks
       (child_sid,source_sid,source_root,source_position,child_root,
        grant_token_hash,verified_at)
     VALUES (
       'claude_00000000-0000-4000-8000-000000000001',
       'codex_00000000-0000-4000-8000-000000000098',
       '${'b'.repeat(64)}',
       1,
       '${'a'.repeat(64)}',
       '${'d'.repeat(64)}',
       3
     );`,
    'UNIQUE constraint failed: hub_session_verified_forks.grant_token_hash',
  )
  const rankedDiscoverySql = await discoverySql({
    query: 'durable',
    tokens: ['durable'],
    sort: 'recommended',
    agent: null,
    rankedAt: 10_000,
    engagementFromDay: '1970-01-01',
    engagementToDayExclusive: '1970-01-02',
    after: null,
    limit: 20,
  })
  const rankedDiscoveryRows = await executeJson(stateDir, rankedDiscoverySql)
  if (
    rankedDiscoveryRows.length !== 1 ||
    rankedDiscoveryRows[0]?.sid !== 'claude_00000000-0000-4000-8000-000000000001' ||
    rankedDiscoveryRows[0]?.handle !== 'alpha-durable' ||
    typeof rankedDiscoveryRows[0]?.sort_score !== 'number'
  ) {
    throw new Error(
      `Discovery ranked SQL returned unexpected rows: ${JSON.stringify(rankedDiscoveryRows)}`,
    )
  }
  await executeJson(
    stateDir,
    await engagementSql('claude_00000000-0000-4000-8000-000000000001', '1970-01-02'),
  )
  const acceptedEngagement = await executeJson(
    stateDir,
    `SELECT qualified_reads
     FROM hub_session_engagement_daily
     WHERE sid='claude_00000000-0000-4000-8000-000000000001' AND day='1970-01-02';`,
  )
  if (acceptedEngagement[0]?.qualified_reads !== 1) {
    throw new Error(
      `Discovery conditional engagement did not count a Public Session: ${JSON.stringify(acceptedEngagement)}`,
    )
  }
  const exhaustedDiscoverySql = await discoverySql({
    query: 'durable',
    tokens: ['durable'],
    sort: 'recommended',
    agent: null,
    rankedAt: 10_000,
    engagementFromDay: '1970-01-01',
    engagementToDayExclusive: '1970-01-02',
    after: {
      rankedAt: 10_000,
      relevanceScore: rankedDiscoveryRows[0].relevance_score,
      sortScore: rankedDiscoveryRows[0].sort_score,
      publishedAt: rankedDiscoveryRows[0].published_at,
      sid: rankedDiscoveryRows[0].sid,
    },
    limit: 20,
  })
  const exhaustedDiscoveryRows = await executeJson(stateDir, exhaustedDiscoverySql)
  if (exhaustedDiscoveryRows.length !== 0) {
    throw new Error(
      `Discovery keyset did not exhaust after its only row: ${JSON.stringify(exhaustedDiscoveryRows)}`,
    )
  }
  const recentDiscoveryRows = await executeJson(
    stateDir,
    await discoverySql({
      query: null,
      tokens: [],
      sort: 'recent',
      agent: 'claude',
      rankedAt: 10_000,
      engagementFromDay: '1970-01-01',
      engagementToDayExclusive: '1970-01-02',
      after: null,
      limit: 20,
    }),
  )
  if (recentDiscoveryRows.length !== 1 || recentDiscoveryRows[0]?.sort_score !== null) {
    throw new Error(
      `Discovery Recent SQL returned unexpected rows: ${JSON.stringify(recentDiscoveryRows)}`,
    )
  }
  await executeJson(
    stateDir,
    `DELETE FROM hub_session_discovery
     WHERE sid='claude_00000000-0000-4000-8000-000000000001';`,
  )
  await executeJson(
    stateDir,
    await engagementSql('claude_00000000-0000-4000-8000-000000000001', '1970-01-02'),
  )
  const rejectedEngagement = await executeJson(
    stateDir,
    `SELECT qualified_reads
     FROM hub_session_engagement_daily
     WHERE sid='claude_00000000-0000-4000-8000-000000000001' AND day='1970-01-02';`,
  )
  if (rejectedEngagement[0]?.qualified_reads !== 1) {
    throw new Error(
      `Discovery engagement changed without a Public projection: ${JSON.stringify(rejectedEngagement)}`,
    )
  }

  const quota = 5 * 1024 * 1024 * 1024
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at) VALUES ('quota-user','quota@example.test',1,1);
     INSERT INTO teams (id,workos_organization_id,name,created_by_user_id,created_at,updated_at)
       VALUES ('team_quota_a','org_quota_a','Quota A','quota-user',1,1),
              ('team_quota_b','org_quota_b','Quota B','quota-user',1,1);
     INSERT INTO hub_team_objects (team_id,oid,size,pack_key,offset,length,created_at)
       VALUES ('team_quota_a','a-main',${quota - 10},'pack-a',0,${quota - 10},1),
              ('team_quota_a','a-tail',10,'pack-a',${quota - 10},10,1),
              ('team_quota_b','b-full',${quota},'pack-b',0,${quota},1);`,
  )

  // Idempotent aliases at the cap must not double count an existing oid.
  await executeJson(
    stateDir,
    `INSERT OR IGNORE INTO hub_team_objects (team_id,oid,size,pack_key,offset,length,created_at)
       VALUES ('team_quota_a','a-tail',10,'pack-a',${quota - 10},10,1);`,
  )
  await expectD1Failure(
    stateDir,
    `INSERT INTO hub_team_objects (team_id,oid,size,pack_key,offset,length,created_at)
       VALUES ('team_quota_a','a-over',1,'pack-over',0,1,1);`,
    'team storage quota exceeded',
  )

  // Same-Team updates exclude only OLD itself; a growth beyond the cap fails.
  await executeJson(
    stateDir,
    "UPDATE hub_team_objects SET size=10 WHERE team_id='team_quota_a' AND oid='a-tail';",
  )
  await expectD1Failure(
    stateDir,
    "UPDATE hub_team_objects SET size=11 WHERE team_id='team_quota_a' AND oid='a-tail';",
    'team storage quota exceeded',
  )

  // A cross-Team move counts every existing target row. It fails while B is
  // full, then succeeds exactly at the boundary after ten bytes are freed.
  await expectD1Failure(
    stateDir,
    "UPDATE hub_team_objects SET team_id='team_quota_b' WHERE team_id='team_quota_a' AND oid='a-tail';",
    'team storage quota exceeded',
  )
  await executeJson(
    stateDir,
    `UPDATE hub_team_objects SET size=${quota - 10} WHERE team_id='team_quota_b' AND oid='b-full';
     UPDATE hub_team_objects SET team_id='team_quota_b' WHERE team_id='team_quota_a' AND oid='a-tail';`,
  )
  const quotaTotals = await executeJson(
    stateDir,
    'SELECT team_id, SUM(size) AS total FROM hub_team_objects GROUP BY team_id ORDER BY team_id;',
  )
  const teamB = quotaTotals.find((row) => row.team_id === 'team_quota_b')
  if (teamB?.total !== quota) {
    throw new Error(`Cross-Team quota trigger produced unexpected total: ${JSON.stringify(teamB)}`)
  }

  console.log(
    `D1 schema smoke passed: ${migrationNames.length} migrations applied; foreign keys and Team quota triggers valid.`,
  )
} finally {
  await rm(stateDir, { force: true, recursive: true })
}
