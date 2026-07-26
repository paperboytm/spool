import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const wranglerEntry = join(appDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

export const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`

const MIGRATION_NAME = /^\d{4}_[A-Za-z0-9_.-]+\.sql$/
const GUARD_TABLE = '__spool_d1_migration_guard'

export function parseArgs(argv) {
  const options = {
    config: undefined,
    database: undefined,
    migrationsDir: join(appDir, 'migrations'),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = argv[index + 1]
    if (value === '--database' && next) {
      options.database = next
      index += 1
      continue
    }
    if (value === '--config' && next) {
      options.config = next
      index += 1
      continue
    }
    if (value === '--migrations-dir' && next) {
      options.migrationsDir = isAbsolute(next) ? next : resolve(appDir, next)
      index += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${value}`)
  }

  if (!options.database || !options.config) {
    throw new Error(
      'Usage: d1-migrate-remote.mjs --database <name> --config <path> [--migrations-dir <path>]',
    )
  }

  return options
}

export async function listMigrationNames(migrationsDir) {
  const entries = await readdir(migrationsDir, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()

  if (names.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDir}`)
  }

  const invalid = names.find((name) => !MIGRATION_NAME.test(name))
  if (invalid) {
    throw new Error(`Migration filename is not safe for the remote ledger: ${invalid}`)
  }

  return names
}

export function validateLedgerPrefix(migrationNames, appliedRows) {
  if (!Array.isArray(appliedRows)) {
    throw new TypeError('D1 returned an invalid migration ledger')
  }
  if (appliedRows.length > migrationNames.length) {
    throw new Error(
      `Remote migration ledger has ${appliedRows.length} entries but only ${migrationNames.length} local migrations exist`,
    )
  }

  for (let index = 0; index < appliedRows.length; index += 1) {
    const actual = appliedRows[index]?.name
    const expected = migrationNames[index]
    if (actual !== expected) {
      throw new Error(
        `Remote migration ledger diverges at position ${index + 1}: expected ${expected}, received ${String(actual)}`,
      )
    }
  }

  return appliedRows.length
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

export function buildMigrationImport(contents, migrationName, expectedCount = 0) {
  if (!MIGRATION_NAME.test(migrationName)) {
    throw new Error(`Migration filename is not safe for the remote ledger: ${migrationName}`)
  }
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`Invalid expected migration count: ${String(expectedCount)}`)
  }

  const source = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  const sql = source.toString('utf8')
  if (source.length === 0 || sql.trim().length === 0) {
    throw new Error(`Migration is empty: ${migrationName}`)
  }
  if (/\bBEGIN\s+TRANSACTION\b/i.test(sql) || /\bCOMMIT\s*;/i.test(sql)) {
    throw new Error(
      `Migration ${migrationName} contains an explicit transaction; D1 imports are already atomic`,
    )
  }
  if (!sql.trimEnd().endsWith(';')) {
    throw new Error(`Migration must end with a SQL statement terminator: ${migrationName}`)
  }

  const separator = source.length > 0 && source[source.length - 1] === 0x0a ? '' : '\n'
  const ledger = Buffer.from(
    `${separator}\n-- Fail atomically if another runner advanced the ledger after our prefix read.\n` +
      `CREATE TABLE "${GUARD_TABLE}" (\n` +
      `  expected_count INTEGER NOT NULL,\n` +
      `  actual_count INTEGER NOT NULL,\n` +
      `  CHECK (expected_count = actual_count)\n` +
      `);\n` +
      `INSERT INTO "${GUARD_TABLE}" (expected_count, actual_count)\n` +
      `SELECT ${expectedCount}, COUNT(*) FROM "d1_migrations";\n` +
      `DROP TABLE "${GUARD_TABLE}";\n\n` +
      `-- Recorded atomically with the schema and data changes above.\n` +
      `INSERT INTO "d1_migrations" (name) VALUES (${sqlString(migrationName)});\n`,
  )
  return Buffer.concat([source, ledger])
}

function formatProcessFailure(args, code, stdout, stderr) {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').slice(0, 8_000)
  return new Error(
    `wrangler ${args.join(' ')} failed with exit code ${String(code)}${output ? `\n${output}` : ''}`,
  )
}

export function runWrangler(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wranglerEntry, ...args], {
      cwd: appDir,
      env: {
        ...process.env,
        NO_COLOR: '1',
        WRANGLER_SEND_METRICS: 'false',
      },
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
        resolvePromise({ stderr, stdout })
        return
      }
      reject(formatProcessFailure(args, code, stdout, stderr))
    })
  })
}

export function parseWranglerJson(stdout) {
  let payload
  try {
    payload = JSON.parse(stdout)
  } catch (error) {
    throw new Error('Wrangler returned invalid JSON', { cause: error })
  }
  if (
    !Array.isArray(payload) ||
    payload.length !== 1 ||
    payload.some((result) => result?.success !== true || !Array.isArray(result.results))
  ) {
    throw new Error('Wrangler returned an unsuccessful D1 response')
  }
  return payload
}

async function executeCommand({ config, database }, command) {
  const { stdout } = await runWrangler([
    'd1',
    'execute',
    database,
    '--remote',
    '--config',
    config,
    '--command',
    command,
    '--json',
  ])
  return parseWranglerJson(stdout)
}

async function readLedger(options) {
  const payload = await executeCommand(options, 'SELECT id, name FROM "d1_migrations" ORDER BY id')
  const rows = payload.flatMap((execution) => execution.results)
  if (
    rows.some(
      (row) =>
        !row ||
        !Number.isSafeInteger(row.id) ||
        row.id <= 0 ||
        typeof row.name !== 'string' ||
        row.name.length === 0,
    )
  ) {
    throw new Error('Wrangler returned an invalid D1 migration ledger')
  }
  return rows
}

async function executeImport({ config, database }, file) {
  await runWrangler([
    'd1',
    'execute',
    database,
    '--remote',
    '--config',
    config,
    '--file',
    file,
    '--yes',
  ])
}

export async function migrateRemote(
  options,
  dependencies = { executeCommand, executeImport, readLedger },
) {
  const migrationNames = await listMigrationNames(options.migrationsDir)

  await dependencies.executeCommand(options, MIGRATIONS_TABLE_SQL)
  let appliedRows = await dependencies.readLedger(options)
  let appliedCount = validateLedgerPrefix(migrationNames, appliedRows)

  if (appliedCount === migrationNames.length) {
    console.log(`D1 migration ledger is current (${appliedCount}/${migrationNames.length}).`)
    return
  }

  for (let index = appliedCount; index < migrationNames.length; index += 1) {
    const migrationName = migrationNames[index]

    // Another queued deployment may have completed while this job was waiting.
    appliedRows = await dependencies.readLedger(options)
    appliedCount = validateLedgerPrefix(migrationNames, appliedRows)
    if (appliedCount > index) {
      continue
    }
    if (appliedCount !== index) {
      throw new Error(
        `Remote migration ledger advanced unexpectedly: expected ${index} applied migrations, received ${appliedCount}`,
      )
    }

    const directory = await mkdtemp(join(tmpdir(), 'spool-d1-migration-'))
    const importFile = join(directory, migrationName)
    try {
      const contents = await readFile(join(options.migrationsDir, migrationName))
      await writeFile(importFile, buildMigrationImport(contents, migrationName, index), {
        mode: 0o600,
      })
      console.log(`Applying ${migrationName} through D1's atomic import endpoint...`)
      try {
        await dependencies.executeImport(options, importFile)
      } catch (error) {
        // A concurrent deployment can win the UNIQUE ledger insert. Accept
        // that failure only when the remote ledger proves the same migration
        // committed atomically; every other failure remains fatal.
        const rowsAfterFailure = await dependencies.readLedger(options)
        const countAfterFailure = validateLedgerPrefix(migrationNames, rowsAfterFailure)
        if (countAfterFailure <= index) {
          throw error
        }
        console.log(`${migrationName} was committed by another deployment.`)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }

  const finalRows = await dependencies.readLedger(options)
  const finalCount = validateLedgerPrefix(migrationNames, finalRows)
  if (finalCount !== migrationNames.length) {
    throw new Error(
      `Remote migration verification failed: expected ${migrationNames.length}, received ${finalCount}`,
    )
  }
  console.log(`D1 migrations applied and verified (${finalCount}/${migrationNames.length}).`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await migrateRemote(options)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
