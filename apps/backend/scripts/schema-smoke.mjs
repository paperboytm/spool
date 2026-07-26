import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { incrementQualifiedReadIfLive, listDiscoveryPage } from '../src/discovery/store.ts'
import { HUB_PROJECTS_LIST_SQL } from '../src/projects/query-sql.ts'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationsDir = join(appDir, 'migrations')
const migrationNames = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

if (migrationNames.length === 0) {
  throw new Error(`No SQL migrations found in ${migrationsDir}`)
}

const wranglerEntry = join(appDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const noProxy = [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
      .filter(Boolean)
      .join(',')
    const child = spawn(process.execPath, [wranglerEntry, ...args], {
      cwd: appDir,
      env: { ...process.env, NO_COLOR: '1', NO_PROXY: noProxy, no_proxy: noProxy },
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

async function executeFile(stateDir, file) {
  await runWrangler([
    'd1',
    'execute',
    'spool-share-db',
    '--local',
    '--persist-to',
    stateDir,
    '--config',
    'wrangler.toml',
    '--file',
    file,
  ])
}

async function expectD1FileFailure(stateDir, file, expectedMessage) {
  try {
    await executeFile(stateDir, file)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedMessage)) {
      throw new Error(`Expected D1 failure containing ${expectedMessage}, received:\n${message}`)
    }
    return
  }
  throw new Error(`Expected D1 file to fail: ${file}`)
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

function bindSql(sql, params) {
  let parameterIndex = 0
  const bound = sql.replaceAll('?', () => {
    if (parameterIndex >= params.length) {
      throw new Error('SQL has more placeholders than bound parameters')
    }
    return sqlLiteral(params[parameterIndex++])
  })
  if (parameterIndex !== params.length) {
    throw new Error('SQL has fewer placeholders than bound parameters')
  }
  return bound
}

async function verifyProjectBackfill() {
  const projectMigrationName = '0014_projects.sql'
  const projectMigrationIndex = migrationNames.indexOf(projectMigrationName)
  if (projectMigrationIndex === -1) {
    throw new Error(`Missing ${projectMigrationName}`)
  }
  if (projectMigrationIndex !== migrationNames.length - 1) {
    throw new Error(`${projectMigrationName} must remain the newest migration for its legacy smoke`)
  }

  const legacyStateDir = await mkdtemp(join(tmpdir(), 'spool-d1-project-backfill-smoke-'))
  const legacySchemaFile = join(legacyStateDir, 'schema-through-0013.sql')

  try {
    const legacyMigrationBodies = await Promise.all(
      migrationNames
        .slice(0, projectMigrationIndex)
        .map((name) => readFile(join(migrationsDir, name), 'utf8')),
    )
    await writeFile(legacySchemaFile, `${legacyMigrationBodies.join('\n\n')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await executeFile(legacyStateDir, legacySchemaFile)

    await executeJson(
      legacyStateDir,
      `INSERT INTO users (id,email,name,created_at,last_signin_at)
         VALUES
           ('legacy-react','react@example.test','React Author',1,1),
           ('legacy-spool','spool@example.test','Spool Author',1,1),
           ('legacy-avatar','avatar@example.test','Avatar Author',1,1),
           ('legacy-generic','generic@example.test','Generic Builder',1,1),
           ('legacy-nameless','private-local-part@example.test',NULL,1,1),
           ('legacy-old','old@example.test','Legacy Holder',1,1);
       INSERT INTO handles (handle,user_id,claimed_at,released_at)
         VALUES
           ('alpha-old-handle','legacy-old',1,NULL),
           ('zeta-old-handle','legacy-old',2,NULL),
           ('xinyao','legacy-react',3,NULL),
           ('spool-before-controlled','legacy-spool',3,NULL),
           ('retired-spool-handle','legacy-spool',1,2);
       INSERT INTO teams
         (id,workos_organization_id,name,created_by_user_id,created_at,updated_at)
         VALUES
           ('team_legacy_paperboy','org_legacy_paperboy','Paperboy','legacy-avatar',1,2),
           ('team_legacy_generic','org_legacy_generic','Research Team','legacy-avatar',1,2),
           ('team_legacy_empty','org_legacy_empty','Empty Team','legacy-avatar',1,2);
       INSERT INTO team_creation_requests
         (user_id,idempotency_key,team_id,normalized_name,status,workos_organization_id,created_at,updated_at)
         VALUES (
           'legacy-avatar',
           'legacy-empty-team-create',
           'team_legacy_empty',
           'Empty Team',
           'completed',
           'org_legacy_empty',
           1,
           2
         );
       INSERT INTO hub_sessions
         (sid,owner_user_id,root,record_count,visibility,team_id,created_at,updated_at)
         VALUES
           (
             'claude_52d60289-1a34-41ff-bf63-a77593a53d8a',
             'legacy-react',
             '${'1'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             10,
             11
           ),
           (
             'claude_9cea282a-d9cf-434d-83f4-633cca085faf',
             'legacy-react',
             '${'2'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             12,
             13
           ),
           (
             'pi_019f75ad-6e1b-7825-8af2-a3f76d33b91d',
             'legacy-react',
             '${'3'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             14,
             15
           ),
           (
             'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
             'legacy-spool',
             '${'4'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             16,
             17
           ),
           (
             'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
             'legacy-spool',
             '${'5'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             18,
             19
           ),
           (
             'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
             'legacy-spool',
             '${'6'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             20,
             21
           ),
           (
             'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
             'legacy-spool',
             '${'7'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             22,
             23
           ),
           (
             'codex_019f8e14-8152-7412-98c7-ab55a1e32de3',
             'legacy-spool',
             '${'8'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             24,
             25
           ),
           (
             'codex_019f845e-2b39-7862-8fb6-287f0af11d12',
             'legacy-avatar',
             '${'9'.repeat(64)}',
             1,
             'private',
             'team_legacy_paperboy',
             26,
             27
           ),
           (
             'claude_team_summary',
             'legacy-avatar',
             '${'a'.repeat(64)}',
             1,
             'private',
             'team_legacy_paperboy',
             28,
             29
           ),
           (
             'codex_avatar_personal_legacy',
             'legacy-avatar',
             '${'c'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             29,
             30
           ),
           (
             'claude_team_other',
             'legacy-avatar',
             '${'b'.repeat(64)}',
             1,
             'private',
             'team_legacy_paperboy',
             30,
             31
           ),
           (
             'codex_generic_owner',
             'legacy-generic',
             '${'d'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             32,
             33
           ),
           (
             'codex_old_owner',
             'legacy-old',
             '${'e'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             34,
             35
           ),
           (
             'codex_nameless_owner',
             'legacy-nameless',
             '${'0'.repeat(64)}',
             1,
             'unlisted',
             NULL,
             35,
             36
           ),
           (
             'codex_generic_team',
             'legacy-avatar',
             '${'f'.repeat(64)}',
             1,
             'private',
             'team_legacy_generic',
             36,
             37
           );
       INSERT INTO hub_session_discovery
         (sid,agent,title,search_text,published_at,updated_at)
         VALUES
           ('claude_team_summary','claude','Improve bilingual Summary','summary',28,29),
           ('claude_team_other','claude','Repair deployment routing','deployment',30,31);`,
    )

    await executeFile(legacyStateDir, join(migrationsDir, projectMigrationName))

    const nullProjects = await executeJson(
      legacyStateDir,
      'SELECT COUNT(*) AS count FROM hub_sessions WHERE project_id IS NULL;',
    )
    if (nullProjects[0]?.count !== 0) {
      throw new Error(`Project backfill left nullable Sessions: ${JSON.stringify(nullProjects)}`)
    }

    const assignmentRows = await executeJson(
      legacyStateDir,
      'SELECT sid,project_id FROM hub_sessions ORDER BY sid;',
    )
    const assignments = Object.fromEntries(assignmentRows.map((row) => [row.sid, row.project_id]))
    const expectedAssignments = {
      'claude_52d60289-1a34-41ff-bf63-a77593a53d8a': 'project_user_legacy-react_react-vapor',
      'claude_9cea282a-d9cf-434d-83f4-633cca085faf': 'project_user_legacy-react_react-vapor',
      'pi_019f75ad-6e1b-7825-8af2-a3f76d33b91d': 'project_default_user_legacy-react',
      'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866': 'project_user_legacy-spool_spool',
      'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595': 'project_user_legacy-spool_spool',
      'codex_019f89dc-54e9-7eb1-97cc-753269f594cb': 'project_user_legacy-spool_spool',
      'codex_019f8a35-c2dd-7b72-a754-839cf3efae86': 'project_user_legacy-spool_spool',
      'codex_019f8e14-8152-7412-98c7-ab55a1e32de3': 'project_user_legacy-spool_spool',
      'codex_019f845e-2b39-7862-8fb6-287f0af11d12':
        'project_team_team_legacy_paperboy_avatar-generator',
      codex_avatar_personal_legacy: 'project_user_legacy-avatar_spool',
      codex_generic_owner: 'project_default_user_legacy-generic',
      codex_nameless_owner: 'project_default_user_legacy-nameless',
      codex_old_owner: 'project_default_user_legacy-old',
      codex_generic_team: 'project_default_team_team_legacy_generic',
      claude_team_summary: 'project_team_team_legacy_paperboy_avatar-generator',
      claude_team_other: 'project_team_team_legacy_paperboy_paperboy',
    }
    const assignmentMismatches = Object.entries(expectedAssignments).filter(
      ([sid, projectId]) => assignments[sid] !== projectId,
    )
    if (
      assignmentRows.length !== Object.keys(expectedAssignments).length ||
      assignmentMismatches.length !== 0
    ) {
      throw new Error(
        `Project backfill assignments are invalid.\nMismatches: ${JSON.stringify(assignmentMismatches)}\nActual: ${JSON.stringify(assignments)}`,
      )
    }

    const projectDescriptionRows = await executeJson(
      legacyStateDir,
      `SELECT slug,COUNT(*) AS project_count,COUNT(DISTINCT description) AS description_count,
              MIN(description) AS description
       FROM projects
       GROUP BY slug
       ORDER BY slug;`,
    )
    const expectedProjectDescriptions = {
      'avatar-generator': {
        count: 1,
        description:
          "Paperboy's avatar generator turns eight fixed retro-futurist illustrations into reproducible default avatars by varying color palettes without redrawing their structure.",
      },
      paperboy: {
        count: 1,
        description:
          'Paperboy is the Team workspace for product and infrastructure work that does not belong to a more specific Project.',
      },
      'react-vapor': {
        count: 1,
        description:
          'React Vapor explores a compiler-driven React execution model that reduces runtime reconciliation while preserving compatibility with existing React code and third-party packages.',
      },
      sessions: {
        count: 8,
        description:
          'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
      },
      spool: {
        count: 2,
        description:
          'Spool turns local coding-agent Sessions into durable, shareable records that people can read, search, and resume across tools.',
      },
    }
    const descriptionMismatches = projectDescriptionRows.filter((row) => {
      const expected = expectedProjectDescriptions[row.slug]
      return (
        expected === undefined ||
        row.project_count !== expected.count ||
        row.description_count !== 1 ||
        row.description !== expected.description
      )
    })
    if (
      projectDescriptionRows.length !== Object.keys(expectedProjectDescriptions).length ||
      descriptionMismatches.length !== 0
    ) {
      throw new Error(
        `Project backfill descriptions are invalid: ${JSON.stringify(projectDescriptionRows)}`,
      )
    }

    const seededHandles = await executeJson(
      legacyStateDir,
      `SELECT handle,user_id,team_id,claimed_at,released_at
       FROM handles
       ORDER BY handle;`,
    )
    if (
      !seededHandles.some(
        (row) =>
          row.handle === 'evan' &&
          row.user_id === 'legacy-spool' &&
          row.team_id === null &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'xinyao' &&
          row.user_id === 'legacy-react' &&
          row.team_id === null &&
          row.claimed_at === 3 &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'vivian-kong' &&
          row.user_id === 'legacy-avatar' &&
          row.team_id === null &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'paperboy' &&
          row.user_id === null &&
          row.team_id === 'team_legacy_paperboy' &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'generic-builder-legacy-g' &&
          row.user_id === 'legacy-generic' &&
          row.team_id === null &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'research-team-team_leg' &&
          row.user_id === null &&
          row.team_id === 'team_legacy_generic' &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'empty-team-team_leg' &&
          row.user_id === null &&
          row.team_id === 'team_legacy_empty' &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'user-legacy-n' &&
          row.user_id === 'legacy-nameless' &&
          row.team_id === null &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'alpha-old-handle' &&
          row.user_id === 'legacy-old' &&
          row.team_id === null &&
          row.released_at === null,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'zeta-old-handle' &&
          row.user_id === 'legacy-old' &&
          row.team_id === null &&
          row.released_at === 2,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'spool-before-controlled' &&
          row.user_id === 'legacy-spool' &&
          row.claimed_at === 3 &&
          row.released_at === 16,
      ) ||
      !seededHandles.some(
        (row) =>
          row.handle === 'retired-spool-handle' &&
          row.user_id === 'legacy-spool' &&
          row.released_at === 2,
      )
    ) {
      throw new Error(`Handle migration/seeds are invalid: ${JSON.stringify(seededHandles)}`)
    }
    const handleCollisions = await executeJson(
      legacyStateDir,
      `SELECT 'handle' AS kind,lower(handle) AS identity,COUNT(*) AS count
       FROM handles
       GROUP BY lower(handle)
       HAVING COUNT(*) > 1
       UNION ALL
       SELECT 'active-user' AS kind,user_id AS identity,COUNT(*) AS count
       FROM handles
       WHERE user_id IS NOT NULL AND released_at IS NULL
       GROUP BY user_id
       HAVING COUNT(*) > 1
       UNION ALL
       SELECT 'active-team' AS kind,team_id AS identity,COUNT(*) AS count
       FROM handles
       WHERE team_id IS NOT NULL AND released_at IS NULL
       GROUP BY team_id
       HAVING COUNT(*) > 1;`,
    )
    if (handleCollisions.length !== 0) {
      throw new Error(`Handle migration left collisions: ${JSON.stringify(handleCollisions)}`)
    }
    const legacyTeamReceipt = await executeJson(
      legacyStateDir,
      `SELECT requested_handle
       FROM team_creation_requests
       WHERE user_id='legacy-avatar' AND idempotency_key='legacy-empty-team-create';`,
    )
    if (legacyTeamReceipt[0]?.requested_handle !== 'empty-team-team_leg') {
      throw new Error(
        `Legacy Team receipt was not backfilled with its handle: ${JSON.stringify(legacyTeamReceipt)}`,
      )
    }
    const missingProjectOwnerHandles = await executeJson(
      legacyStateDir,
      `SELECT COUNT(*) AS count
       FROM (
         SELECT DISTINCT 'user' AS owner_kind,p.owner_user_id AS owner_id
         FROM projects p
         WHERE
           p.archived_at IS NULL AND
           p.owner_user_id IS NOT NULL AND
           NOT EXISTS (
             SELECT 1
             FROM handles h
             WHERE h.user_id = p.owner_user_id AND h.released_at IS NULL
           )
         UNION ALL
         SELECT DISTINCT 'team' AS owner_kind,p.owner_team_id AS owner_id
         FROM projects p
         WHERE
           p.archived_at IS NULL AND
           p.owner_team_id IS NOT NULL AND
           NOT EXISTS (
             SELECT 1
             FROM handles h
             WHERE h.team_id = p.owner_team_id AND h.released_at IS NULL
           )
       );`,
    )
    if (missingProjectOwnerHandles[0]?.count !== 0) {
      throw new Error(
        `Active Project owners are missing handles: ${JSON.stringify(missingProjectOwnerHandles)}`,
      )
    }

    const legacyForeignKeyViolations = await executeJson(
      legacyStateDir,
      'PRAGMA foreign_key_check;',
    )
    if (legacyForeignKeyViolations.length !== 0) {
      throw new Error(
        `Project backfill foreign-key violations: ${JSON.stringify(legacyForeignKeyViolations)}`,
      )
    }
  } finally {
    await rm(legacyStateDir, { force: true, recursive: true })
  }
}

async function verifyControlledHandleConflict() {
  const projectMigrationName = '0014_projects.sql'
  const projectMigrationIndex = migrationNames.indexOf(projectMigrationName)
  if (projectMigrationIndex === -1) {
    throw new Error(`Missing ${projectMigrationName}`)
  }

  const conflictStateDir = await mkdtemp(
    join(tmpdir(), 'spool-d1-controlled-handle-conflict-smoke-'),
  )
  const legacySchemaFile = join(conflictStateDir, 'schema-through-0013.sql')

  try {
    const legacyMigrationBodies = await Promise.all(
      migrationNames
        .slice(0, projectMigrationIndex)
        .map((name) => readFile(join(migrationsDir, name), 'utf8')),
    )
    await writeFile(legacySchemaFile, `${legacyMigrationBodies.join('\n\n')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await executeFile(conflictStateDir, legacySchemaFile)

    await executeJson(
      conflictStateDir,
      `INSERT INTO users (id,email,name,created_at,last_signin_at)
         VALUES
           ('intended-owner','intended@example.test','Intended Owner',1,1),
           ('route-squatter','squatter@example.test','Route Squatter',1,1);
       INSERT INTO handles (handle,user_id,claimed_at,released_at)
         VALUES
           ('react-before-controlled','intended-owner',2,NULL),
           ('xinyao','route-squatter',2,NULL);
       INSERT INTO hub_sessions
         (sid,owner_user_id,root,record_count,visibility,created_at,updated_at)
         VALUES (
           'claude_52d60289-1a34-41ff-bf63-a77593a53d8a',
           'intended-owner',
           '${'1'.repeat(64)}',
           1,
           'unlisted',
           10,
           11
         );`,
    )

    await expectD1FileFailure(
      conflictStateDir,
      join(migrationsDir, projectMigrationName),
      'controlled_handle_seed_conflict',
    )

    const preservedClaims = await executeJson(
      conflictStateDir,
      `SELECT handle,user_id,released_at
       FROM handles
       WHERE handle IN ('react-before-controlled','xinyao')
       ORDER BY handle;`,
    )
    if (
      preservedClaims.length !== 2 ||
      preservedClaims[0]?.handle !== 'react-before-controlled' ||
      preservedClaims[0]?.user_id !== 'intended-owner' ||
      preservedClaims[0]?.released_at !== null ||
      preservedClaims[1]?.handle !== 'xinyao' ||
      preservedClaims[1]?.user_id !== 'route-squatter' ||
      preservedClaims[1]?.released_at !== null
    ) {
      throw new Error(
        `Controlled handle conflict mutated legacy claims: ${JSON.stringify(preservedClaims)}`,
      )
    }
  } finally {
    await rm(conflictStateDir, { force: true, recursive: true })
  }
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
       (user_id,idempotency_key,team_id,normalized_name,requested_handle,status,workos_organization_id,created_at,updated_at)
       VALUES ('durable-user','create_durable_0001','team_durable','Durable','active-team-handle','completed','org_durable',1,1);
     INSERT INTO team_invitation_requests
       (team_id,invited_by_user_id,idempotency_key,invitation_id,normalized_email,desired_role,status,workos_invitation_id,created_at,updated_at)
       VALUES ('team_durable','durable-user','invite_durable_0001','tinv_durable','invitee@example.test','member','completed','inv_durable',1,1);
     INSERT INTO workos_membership_denials
       (organization_id,membership_id,workos_user_id,reason,workos_updated_at,team_id,user_id,previous_role,denied_at,event_id)
       VALUES ('org_denied','om_denied','workos_denied','inactive',1,NULL,NULL,NULL,1,'event_denied');
     INSERT INTO workos_user_denials (workos_user_id,denied_at,event_id)
       VALUES ('workos_deleted',1,'event_user_deleted');
     INSERT INTO projects
       (id,owner_user_id,owner_team_id,slug,name,created_by_user_id,created_at,updated_at)
       VALUES
         ('project_default_user_durable-user','durable-user',NULL,'sessions','Sessions','durable-user',1,1),
         ('project_user_durable-user_secondary','durable-user',NULL,'secondary','Secondary','durable-user',1,1),
         ('project_default_team_team_durable',NULL,'team_durable','sessions','Sessions','durable-user',1,1);
     INSERT INTO project_creation_requests
       (actor_user_id,owner_scope,owner_user_id,owner_team_id,idempotency_key,project_id,
        request_hash,created_at)
       VALUES (
         'durable-user',
         'user:durable-user',
         'durable-user',
         NULL,
         'project-create-user-0001',
         'project_default_user_durable-user',
         '${'e'.repeat(64)}',
         1
       );`,
  )

  const handleColumns = await executeJson(stateDir, 'PRAGMA table_info(handles);')
  if (
    JSON.stringify(handleColumns.map((column) => column.name)) !==
    JSON.stringify(['handle', 'user_id', 'team_id', 'claimed_at', 'released_at'])
  ) {
    throw new Error(`Missing global handle schema: ${JSON.stringify(handleColumns)}`)
  }
  const teamCreationColumns = await executeJson(
    stateDir,
    'PRAGMA table_info(team_creation_requests);',
  )
  if (!teamCreationColumns.some((column) => column.name === 'requested_handle')) {
    throw new Error(`Missing Team creation handle intent: ${JSON.stringify(teamCreationColumns)}`)
  }
  const projectColumns = await executeJson(stateDir, 'PRAGMA table_info(projects);')
  if (
    JSON.stringify(projectColumns.map((column) => column.name)) !==
    JSON.stringify([
      'id',
      'owner_user_id',
      'owner_team_id',
      'slug',
      'name',
      'description',
      'github_url',
      'created_by_user_id',
      'created_at',
      'updated_at',
      'archived_at',
    ])
  ) {
    throw new Error(`Missing Project schema: ${JSON.stringify(projectColumns)}`)
  }
  const sessionColumns = await executeJson(stateDir, 'PRAGMA table_info(hub_sessions);')
  if (!sessionColumns.some((column) => column.name === 'project_id')) {
    throw new Error('hub_sessions.project_id was not migrated')
  }
  const sessionProjectForeignKey = (
    await executeJson(stateDir, 'PRAGMA foreign_key_list(hub_sessions);')
  ).find((foreignKey) => foreignKey.from === 'project_id')
  if (
    sessionProjectForeignKey?.table !== 'projects' ||
    sessionProjectForeignKey?.to !== 'id' ||
    sessionProjectForeignKey?.on_delete !== 'RESTRICT'
  ) {
    throw new Error(
      `hub_sessions.project_id foreign key is invalid: ${JSON.stringify(sessionProjectForeignKey)}`,
    )
  }
  const projectRequestColumns = await executeJson(
    stateDir,
    'PRAGMA table_info(project_creation_requests);',
  )
  if (
    JSON.stringify(projectRequestColumns.map((column) => column.name)) !==
    JSON.stringify([
      'actor_user_id',
      'owner_scope',
      'owner_user_id',
      'owner_team_id',
      'idempotency_key',
      'project_id',
      'request_hash',
      'created_at',
    ])
  ) {
    throw new Error(
      `Missing Project creation idempotency schema: ${JSON.stringify(projectRequestColumns)}`,
    )
  }
  const projectTriggers = await executeJson(
    stateDir,
    `SELECT name
     FROM sqlite_master
     WHERE type='trigger' AND name IN (
       'handles_identity_immutable',
       'handles_release_monotonic',
       'handles_no_delete',
       'team_creation_requests_handle_immutable',
       'teams_legacy_creation_handle',
       'projects_tenant_immutable',
       'users_retire_projects',
       'teams_retire_projects',
       'hub_sessions_project_legacy_insert',
       'hub_sessions_project_required_update',
       'hub_sessions_project_tenant_insert',
       'hub_sessions_project_tenant_update',
       'hub_sessions_project_legacy_team_transfer'
     )
     ORDER BY name;`,
  )
  if (projectTriggers.length !== 13) {
    throw new Error(`Missing handle/Project triggers: ${JSON.stringify(projectTriggers)}`)
  }
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES ('legacy-team-owner','legacy-team-owner@example.test',1,1);
     INSERT INTO team_creation_requests
       (user_id,idempotency_key,team_id,normalized_name,status,workos_organization_id,created_at,updated_at)
     VALUES (
       'legacy-team-owner',
       'create_without_handle',
       'team_0123456789abcdef0123456789abcdef',
       'Rolling Team',
       'pending',
       'org_rolling_team',
       2,
       2
     );
     INSERT INTO teams
       (id,workos_organization_id,name,created_by_user_id,created_at,updated_at,
        deletion_pending_until,archived_at)
     SELECT
       'team_0123456789abcdef0123456789abcdef',
       'org_rolling_team',
       'Rolling Team',
       'legacy-team-owner',
       3,
       3,
       NULL,
       NULL
     WHERE EXISTS (
       SELECT 1 FROM team_creation_requests
       WHERE user_id='legacy-team-owner'
         AND idempotency_key='create_without_handle'
         AND status='pending'
     );
     INSERT INTO team_memberships
       (team_id,user_id,role,workos_membership_id,joined_at,updated_at)
     VALUES (
       'team_0123456789abcdef0123456789abcdef',
       'legacy-team-owner',
       'owner',
       'membership_rolling_team',
       3,
       3
     );
     UPDATE team_creation_requests
     SET status='completed',updated_at=3
     WHERE user_id='legacy-team-owner' AND idempotency_key='create_without_handle';`,
  )
  const legacyTeamHandle = await executeJson(
    stateDir,
    `SELECT request.requested_handle, handle.handle
     FROM team_creation_requests request
     LEFT JOIN handles handle
       ON handle.team_id=request.team_id AND handle.released_at IS NULL
     WHERE request.user_id='legacy-team-owner'
       AND request.idempotency_key='create_without_handle';`,
  )
  if (
    legacyTeamHandle.length !== 1 ||
    typeof legacyTeamHandle[0]?.requested_handle !== 'string' ||
    legacyTeamHandle[0]?.requested_handle !== legacyTeamHandle[0]?.handle
  ) {
    throw new Error(
      `Legacy Team creation did not atomically adopt a handle: ${JSON.stringify(legacyTeamHandle)}`,
    )
  }
  await expectD1Failure(
    stateDir,
    `UPDATE team_creation_requests
     SET requested_handle='different-rolling-handle'
     WHERE user_id='legacy-team-owner' AND idempotency_key='create_without_handle';`,
    'team creation handle is immutable',
  )
  await expectD1Failure(
    stateDir,
    `UPDATE team_creation_requests
     SET requested_handle='different-handle'
     WHERE user_id='durable-user' AND idempotency_key='create_durable_0001';`,
    'team creation handle is immutable',
  )

  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES
         ('handle-user-a','handle-a@example.test',1,1),
         ('handle-user-b','handle-b@example.test',1,1);
     INSERT INTO handles (handle,user_id,team_id,claimed_at,released_at)
       VALUES
         ('active-user-handle','handle-user-a',NULL,1,NULL),
         ('retired-user-handle','handle-user-a',NULL,1,2),
         ('active-team-handle',NULL,'team_durable',1,NULL);`,
  )
  await expectD1Failure(
    stateDir,
    `INSERT INTO handles (handle,user_id,team_id,claimed_at,released_at)
     VALUES ('second-user-handle','handle-user-a',NULL,2,NULL);`,
    'UNIQUE constraint failed: handles.user_id',
  )
  await expectD1Failure(
    stateDir,
    `INSERT INTO handles (handle,user_id,team_id,claimed_at,released_at)
     VALUES ('second-team-handle',NULL,'team_durable',2,NULL);`,
    'UNIQUE constraint failed: handles.team_id',
  )
  await expectD1Failure(
    stateDir,
    `INSERT INTO handles (handle,user_id,team_id,claimed_at,released_at)
     VALUES ('ACTIVE-TEAM-HANDLE','handle-user-b',NULL,2,NULL);`,
    'UNIQUE constraint failed: handles.handle',
  )
  await expectD1Failure(
    stateDir,
    "UPDATE handles SET released_at=NULL WHERE handle='retired-user-handle';",
    'released handle is a permanent tombstone',
  )
  await expectD1Failure(
    stateDir,
    "DELETE FROM handles WHERE handle='retired-user-handle';",
    'handle tombstones cannot be deleted',
  )
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES ('retire-user','retire-user@example.test',1,1);
     INSERT INTO teams
       (id,workos_organization_id,name,created_by_user_id,created_at,updated_at)
       VALUES ('team_retire','org_retire','Retire Team','durable-user',1,1);
     INSERT INTO handles (handle,user_id,team_id,claimed_at,released_at)
       VALUES
         ('retire-user-handle','retire-user',NULL,1,NULL),
         ('retire-team-handle',NULL,'team_retire',1,NULL);
     INSERT INTO projects
       (id,owner_user_id,owner_team_id,slug,name,created_by_user_id,created_at,updated_at)
       VALUES
         ('project_default_user_retire-user','retire-user',NULL,'sessions','Sessions','retire-user',1,1),
         ('project_default_team_team_retire',NULL,'team_retire','sessions','Sessions','durable-user',1,1);
     UPDATE users SET deleted_at=10 WHERE id='retire-user';
     UPDATE teams SET archived_at=11 WHERE id='team_retire';`,
  )
  const retiredOwnerState = await executeJson(
    stateDir,
    `SELECT
       (SELECT released_at FROM handles WHERE handle='retire-user-handle') AS user_handle,
       (SELECT archived_at FROM projects WHERE id='project_default_user_retire-user') AS user_project,
       (SELECT released_at FROM handles WHERE handle='retire-team-handle') AS team_handle,
       (SELECT archived_at FROM projects WHERE id='project_default_team_team_retire') AS team_project;`,
  )
  if (
    retiredOwnerState.length !== 1 ||
    retiredOwnerState[0]?.user_handle !== 10 ||
    retiredOwnerState[0]?.user_project !== 10 ||
    retiredOwnerState[0]?.team_handle !== 11 ||
    retiredOwnerState[0]?.team_project !== 11
  ) {
    throw new Error(
      `Owner retirement did not archive handles/Projects: ${JSON.stringify(retiredOwnerState)}`,
    )
  }
  await expectD1Failure(
    stateDir,
    `INSERT INTO project_creation_requests
       (actor_user_id,owner_scope,owner_user_id,owner_team_id,idempotency_key,project_id,
        request_hash,created_at)
     VALUES (
       'durable-user',
       'user:durable-user',
       'durable-user',
       NULL,
       'project-create-user-0001',
       'project_user_durable-user_secondary',
       '${'f'.repeat(64)}',
       2
     );`,
    'UNIQUE constraint failed',
  )
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES ('0123456789abcdef','legacy-hub-user@example.test',1,1);
     INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,created_at,updated_at)
     VALUES (
       'codex_project_legacy_personal',
       '0123456789abcdef',
       '${'1'.repeat(64)}',
       1,
       'unlisted',
       1,
       1
     );`,
  )
  const legacyPersonalProject = await executeJson(
    stateDir,
    `SELECT
       session.project_id,
       project.owner_user_id,
       project.owner_team_id,
       handle.handle AS owner_handle
     FROM hub_sessions session
     JOIN projects project ON project.id=session.project_id
     LEFT JOIN handles handle
       ON handle.user_id=session.owner_user_id AND handle.released_at IS NULL
     WHERE session.sid='codex_project_legacy_personal';`,
  )
  if (
    legacyPersonalProject.length !== 1 ||
    legacyPersonalProject[0]?.project_id !== 'project_default_user_0123456789abcdef' ||
    legacyPersonalProject[0]?.owner_user_id !== '0123456789abcdef' ||
    legacyPersonalProject[0]?.owner_team_id !== null ||
    legacyPersonalProject[0]?.owner_handle !== 'user-0123456789abcdef'
  ) {
    throw new Error(
      `Legacy Hub insert did not receive a Personal fallback Project: ${JSON.stringify(legacyPersonalProject)}`,
    )
  }
  await executeJson(
    stateDir,
    `UPDATE hub_sessions
     SET
       visibility='private',
       team_id='team_0123456789abcdef0123456789abcdef',
       updated_at=2
     WHERE sid='codex_project_legacy_personal';`,
  )
  const legacyTransferredProject = await executeJson(
    stateDir,
    `SELECT session.project_id,project.owner_user_id,project.owner_team_id
     FROM hub_sessions session
     JOIN projects project ON project.id=session.project_id
     WHERE session.sid='codex_project_legacy_personal';`,
  )
  if (
    legacyTransferredProject.length !== 1 ||
    legacyTransferredProject[0]?.project_id !==
      'project_default_team_team_0123456789abcdef0123456789abcdef' ||
    legacyTransferredProject[0]?.owner_user_id !== null ||
    legacyTransferredProject[0]?.owner_team_id !== 'team_0123456789abcdef0123456789abcdef'
  ) {
    throw new Error(
      `Legacy Personal-to-Team transfer did not switch Projects: ${JSON.stringify(legacyTransferredProject)}`,
    )
  }
  await executeJson(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,team_id,created_at,updated_at)
     VALUES (
       'claude_project_legacy_team_insert',
       '0123456789abcdef',
       '${'5'.repeat(64)}',
       1,
       'private',
       'team_0123456789abcdef0123456789abcdef',
       3,
       3
     );`,
  )
  const legacyTeamProject = await executeJson(
    stateDir,
    `SELECT project_id
     FROM hub_sessions
     WHERE sid='claude_project_legacy_team_insert';`,
  )
  if (
    legacyTeamProject.length !== 1 ||
    legacyTeamProject[0]?.project_id !==
      'project_default_team_team_0123456789abcdef0123456789abcdef'
  ) {
    throw new Error(
      `Legacy Team Hub insert did not receive a Team fallback Project: ${JSON.stringify(legacyTeamProject)}`,
    )
  }
  await expectD1Failure(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,team_id,project_id,created_at,updated_at)
     VALUES (
       'codex_project_personal_mismatch',
       'durable-user',
       '${'2'.repeat(64)}',
       1,
       'unlisted',
       NULL,
       'project_default_team_team_durable',
       1,
       1
     );`,
    'hub session project tenant mismatch',
  )
  await executeJson(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,team_id,project_id,created_at,updated_at)
     VALUES
       (
         'codex_project_personal_valid',
         'durable-user',
         '${'3'.repeat(64)}',
         1,
         'unlisted',
         NULL,
         'project_default_user_durable-user',
         1,
         1
       ),
       (
         'codex_project_team_valid',
         'durable-user',
         '${'4'.repeat(64)}',
         1,
         'private',
         'team_durable',
         'project_default_team_team_durable',
         1,
         1
       );`,
  )
  await expectD1Failure(
    stateDir,
    "UPDATE hub_sessions SET project_id=NULL WHERE sid='codex_project_personal_valid';",
    'hub session project is required',
  )
  await expectD1Failure(
    stateDir,
    `UPDATE hub_sessions
     SET project_id='project_default_team_team_durable'
     WHERE sid='codex_project_personal_valid';`,
    'hub session project tenant mismatch',
  )

  const discoveryIndexes = await executeJson(
    stateDir,
    "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('hub_discovery_agent_published_sid','hub_discovery_published_sid') ORDER BY name;",
  )
  if (discoveryIndexes.length !== 2) {
    throw new Error(`Missing Discovery keyset indexes: ${JSON.stringify(discoveryIndexes)}`)
  }
  const discoveryColumns = await executeJson(stateDir, 'PRAGMA table_info(hub_session_discovery);')
  if (!discoveryColumns.some((column) => column.name === 'summary_text_zh')) {
    throw new Error('hub_session_discovery.summary_text_zh was not migrated')
  }
  const guidanceColumns = await executeJson(stateDir, 'PRAGMA table_info(hub_session_guidance);')
  const guidanceColumnNames = guidanceColumns.map((column) => column.name)
  if (
    JSON.stringify(guidanceColumnNames) !==
    JSON.stringify(['sid', 'root', 'guidance_json', 'generated_at'])
  ) {
    throw new Error(`Missing Session guidance schema: ${JSON.stringify(guidanceColumnNames)}`)
  }
  const guidanceForeignKeys = await executeJson(
    stateDir,
    'PRAGMA foreign_key_list(hub_session_guidance);',
  )
  if (
    guidanceForeignKeys.length !== 1 ||
    guidanceForeignKeys[0]?.table !== 'hub_sessions' ||
    guidanceForeignKeys[0]?.from !== 'sid' ||
    guidanceForeignKeys[0]?.to !== 'sid' ||
    guidanceForeignKeys[0]?.on_delete !== 'CASCADE'
  ) {
    throw new Error(
      `Session guidance foreign key is invalid: ${JSON.stringify(guidanceForeignKeys)}`,
    )
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
       (sid,owner_user_id,root,record_count,visibility,project_id,created_at,updated_at)
       VALUES (
         'codex_00000000-0000-4000-8000-000000000099',
         'durable-user',
         '${'c'.repeat(64)}',
         1,
         'unlisted',
         'project_default_user_durable-user',
         1,
         1
       );
     INSERT INTO hub_session_stars (sid,user_id,created_at)
       VALUES ('codex_00000000-0000-4000-8000-000000000099','social-viewer',1);
     INSERT OR IGNORE INTO hub_session_stars (sid,user_id,created_at)
       VALUES ('codex_00000000-0000-4000-8000-000000000099','social-viewer',2);
     INSERT INTO hub_session_guidance (sid,root,guidance_json,generated_at)
       VALUES (
         'codex_00000000-0000-4000-8000-000000000099',
         '${'c'.repeat(64)}',
         '{"v":1,"turns":[]}',
         1
       );`,
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
  const cascadedGuidance = await executeJson(
    stateDir,
    "SELECT COUNT(*) AS count FROM hub_session_guidance WHERE sid='codex_00000000-0000-4000-8000-000000000099';",
  )
  if (cascadedGuidance[0]?.count !== 0) {
    throw new Error(`Session guidance target cascade failed: ${JSON.stringify(cascadedGuidance)}`)
  }
  await executeJson(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,project_id,created_at,updated_at)
       VALUES (
         'claude_00000000-0000-4000-8000-000000000001',
         'durable-user',
         '${'a'.repeat(64)}',
         12,
         'unlisted',
         'project_default_user_durable-user',
         1,
         1
       );
     INSERT INTO hub_session_discovery
       (sid,agent,title,summary_text,summary_text_zh,search_text,message_count,tool_call_count,
        file_count,additions,deletions,quality_score,published_at,updated_at)
       VALUES (
         'claude_00000000-0000-4000-8000-000000000001',
         'claude',
         'Durable result',
         'A durable discovery result.',
         '一个可靠的发现结果。',
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
     INSERT INTO hub_session_guidance (sid,root,guidance_json,generated_at)
       VALUES (
         'claude_00000000-0000-4000-8000-000000000001',
         '${'a'.repeat(64)}',
         '{"v":1,"turns":[{"promptRecord":0,"replyRecords":[1],"replyChars":12,"toolCalls":1}]}',
         1
       );
     INSERT INTO hub_session_engagement_daily (sid,day,qualified_reads)
       VALUES ('claude_00000000-0000-4000-8000-000000000001','1970-01-01',5);
     INSERT INTO handles (handle,user_id,claimed_at,released_at)
       VALUES
         ('zeta-durable','durable-user',1,2),
         ('alpha-durable','durable-user',2,NULL);`,
  )
  const hubProjectRows = await executeJson(
    stateDir,
    bindSql(HUB_PROJECTS_LIST_SQL, ['durable-user', 0, 0, 0, '', 101]),
  )
  if (
    hubProjectRows.length !== 3 ||
    !hubProjectRows.every((row) => row.can_manage === 1) ||
    JSON.stringify(hubProjectRows.map((row) => [row.id, row.owner_handle])) !==
      JSON.stringify([
        ['project_default_team_team_durable', 'active-team-handle'],
        ['project_default_user_durable-user', 'alpha-durable'],
        ['project_user_durable-user_secondary', 'alpha-durable'],
      ])
  ) {
    throw new Error(`Hub Projects SQL returned unexpected rows: ${JSON.stringify(hubProjectRows)}`)
  }
  await executeJson(
    stateDir,
    `INSERT INTO hub_sessions
       (sid,owner_user_id,root,record_count,visibility,project_id,created_at,updated_at)
       VALUES (
         'codex_00000000-0000-4000-8000-000000000098',
         'durable-user',
         '${'b'.repeat(64)}',
         2,
         'unlisted',
         'project_default_user_durable-user',
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
  const guidanceRows = await executeJson(
    stateDir,
    `SELECT root,guidance_json,generated_at
     FROM hub_session_guidance
     WHERE sid='claude_00000000-0000-4000-8000-000000000001';`,
  )
  if (
    guidanceRows.length !== 1 ||
    guidanceRows[0]?.root !== 'a'.repeat(64) ||
    guidanceRows[0]?.generated_at !== 1 ||
    JSON.parse(guidanceRows[0]?.guidance_json ?? 'null')?.v !== 1
  ) {
    throw new Error(`Session guidance row did not round-trip: ${JSON.stringify(guidanceRows)}`)
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

  // Project creation enforces its tenant quota in the final INSERT predicate.
  // This exercises D1's exact COUNT/INSERT behavior at the boundary rather
  // than relying on an application preflight that concurrent requests could
  // both pass.
  await executeJson(
    stateDir,
    `INSERT INTO users (id,email,created_at,last_signin_at)
       VALUES ('project-quota-user','project-quota@example.test',1,1);
     INSERT INTO handles (handle,user_id,claimed_at,released_at)
       VALUES ('project-quota-user','project-quota-user',1,NULL);
     WITH RECURSIVE sequence(n) AS (
       SELECT 1
       UNION ALL
       SELECT n + 1 FROM sequence WHERE n < 100
     )
     INSERT INTO projects
       (id,owner_user_id,owner_team_id,slug,name,description,github_url,
        created_by_user_id,created_at,updated_at,archived_at)
     SELECT
       'project_quota_' || printf('%03d',n),
       'project-quota-user',
       NULL,
       'quota-' || printf('%03d',n),
       'Quota ' || n,
       NULL,
       NULL,
       'project-quota-user',
       n,
       n,
       NULL
     FROM sequence;
     INSERT INTO projects
       (id,owner_user_id,owner_team_id,slug,name,description,github_url,
        created_by_user_id,created_at,updated_at,archived_at)
     SELECT
       'project_quota_over',
       'project-quota-user',
       NULL,
       'quota-over',
       'Quota over',
       NULL,
       NULL,
       'project-quota-user',
       101,
       101,
       NULL
     WHERE (
       SELECT COUNT(*) FROM projects active_project
       WHERE active_project.owner_user_id IS 'project-quota-user'
         AND active_project.owner_team_id IS NULL
         AND active_project.archived_at IS NULL
     ) < 100;`,
  )
  const projectQuotaRows = await executeJson(
    stateDir,
    `SELECT COUNT(*) AS active_count,
       SUM(CASE WHEN id='project_quota_over' THEN 1 ELSE 0 END) AS overflow_count
     FROM projects
     WHERE owner_user_id='project-quota-user' AND archived_at IS NULL;`,
  )
  if (projectQuotaRows[0]?.active_count !== 100 || projectQuotaRows[0]?.overflow_count !== 0) {
    throw new Error(`Project quota guard failed: ${JSON.stringify(projectQuotaRows)}`)
  }

  const projectIntegrity = await executeJson(
    stateDir,
    `SELECT
       SUM(CASE WHEN s.project_id IS NULL THEN 1 ELSE 0 END) AS null_projects,
       SUM(
         CASE
           WHEN s.team_id IS NULL AND NOT (
             p.owner_user_id = s.owner_user_id AND p.owner_team_id IS NULL
           ) THEN 1
           WHEN s.team_id IS NOT NULL AND NOT (
             p.owner_user_id IS NULL AND p.owner_team_id = s.team_id
           ) THEN 1
           ELSE 0
         END
       ) AS tenant_mismatches
     FROM hub_sessions s
     LEFT JOIN projects p ON p.id = s.project_id;`,
  )
  if (
    projectIntegrity.length !== 1 ||
    projectIntegrity[0]?.null_projects !== 0 ||
    projectIntegrity[0]?.tenant_mismatches !== 0
  ) {
    throw new Error(`Hub Project integrity is invalid: ${JSON.stringify(projectIntegrity)}`)
  }

  const finalForeignKeyViolations = await executeJson(stateDir, 'PRAGMA foreign_key_check;')
  if (finalForeignKeyViolations.length !== 0) {
    throw new Error(
      `Post-fixture foreign-key violations: ${JSON.stringify(finalForeignKeyViolations)}`,
    )
  }

  await verifyProjectBackfill()
  await verifyControlledHandleConflict()

  console.log(
    `D1 schema smoke passed: ${migrationNames.length} migrations applied; foreign keys, handle/Project lifecycle, Project backfill, and Team quota triggers valid.`,
  )
} finally {
  await rm(stateDir, { force: true, recursive: true })
}
