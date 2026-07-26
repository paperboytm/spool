import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vite-plus/test'

// The deployment utility is plain ESM so CI can execute it without a build step.
// @ts-expect-error The checked-in operational script deliberately has no TS build artifact.
import * as remoteMigrations from '../scripts/d1-migrate-remote.mjs'

const {
  MIGRATIONS_TABLE_SQL,
  buildMigrationImport,
  listMigrationNames,
  migrateRemote,
  parseArgs,
  parseWranglerJson,
  validateLedgerPrefix,
} = remoteMigrations

describe('remote D1 migration runner', () => {
  it('requires an explicit database and Wrangler config', () => {
    expect(() => parseArgs([])).toThrow('Usage:')
    expect(
      parseArgs(['--database', 'example-db', '--config', 'wrangler.example.toml']),
    ).toMatchObject({
      config: 'wrangler.example.toml',
      database: 'example-db',
    })
    expect(() => parseArgs(['--wat'])).toThrow('Unknown or incomplete argument')
  })

  it('keeps production and staging on the atomic remote runner', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      scripts: Record<string, string>
    }

    for (const name of ['d1:migrate:prod', 'd1:migrate:staging']) {
      expect(packageJson.scripts[name]).toContain('scripts/d1-migrate-remote.mjs')
      expect(packageJson.scripts[name]).not.toContain('migrations apply')
    }
  })

  it('fails closed on malformed or incomplete Wrangler JSON', () => {
    expect(() => parseWranglerJson('not json')).toThrow('invalid JSON')
    expect(() => parseWranglerJson('[]')).toThrow('unsuccessful D1 response')
    expect(() => parseWranglerJson('[{"success":true}]')).toThrow('unsuccessful D1 response')
    expect(parseWranglerJson('[{"success":true,"results":[]}]')).toEqual([
      { results: [], success: true },
    ])
  })

  it('preserves migration bytes and appends the ledger write', () => {
    const source = Buffer.from([
      0xef, 0xbb, 0xbf, 0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, 0x31, 0x3b,
    ])
    const result = buildMigrationImport(source, '0014_projects.sql', 13)

    expect(result.subarray(0, source.length)).toEqual(source)
    expect(result.toString('utf8')).toContain('SELECT 13, COUNT(*) FROM "d1_migrations";')
    expect(result.toString('utf8')).toContain(
      `INSERT INTO "d1_migrations" (name) VALUES ('0014_projects.sql');`,
    )
  })

  it('rejects explicit transactions because D1 imports own the transaction', () => {
    expect(() =>
      buildMigrationImport('BEGIN TRANSACTION; SELECT 1; COMMIT;', '0001_bad.sql'),
    ).toThrow('already atomic')
  })

  it('rejects an unterminated migration before touching D1', () => {
    expect(() => buildMigrationImport('SELECT 1', '0001_bad.sql')).toThrow(
      'must end with a SQL statement terminator',
    )
  })

  it('accepts only an exact prefix of the local migration order', () => {
    const migrations = ['0001_init.sql', '0002_projects.sql']

    expect(validateLedgerPrefix(migrations, [{ name: '0001_init.sql' }])).toBe(1)
    expect(() => validateLedgerPrefix(migrations, [{ name: '0002_projects.sql' }])).toThrow(
      'diverges at position 1',
    )
    expect(() =>
      validateLedgerPrefix(migrations, [
        { name: '0001_init.sql' },
        { name: '0002_projects.sql' },
        { name: '0003_unknown.sql' },
      ]),
    ).toThrow('only 2 local migrations exist')
  })

  it('sorts safe migration files and rejects unsafe ledger names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spool-d1-list-test-'))
    try {
      await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;')
      await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;')
      await writeFile(join(directory, 'README.md'), 'ignored')
      await expect(listMigrationNames(directory)).resolves.toEqual([
        '0001_first.sql',
        '0002_second.sql',
      ])

      await writeFile(join(directory, "0003_bad'name.sql"), 'SELECT 3;')
      await expect(listMigrationNames(directory)).rejects.toThrow('Migration filename is not safe')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('imports pending migrations with the ledger in the same file and verifies the result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spool-d1-runner-test-'))
    const ledger: Array<{ id: number; name: string }> = [{ id: 1, name: '0001_first.sql' }]
    const executeCommand = vi.fn(async () => [{ results: [], success: true }])
    const executeImport = vi.fn(async (_options: unknown, file: string) => {
      const imported = await readFile(file, 'utf8')
      expect(imported).toContain('CREATE TABLE projects')
      expect(imported).toContain('SELECT 1, COUNT(*) FROM "d1_migrations";')
      expect(imported).toContain(`INSERT INTO "d1_migrations" (name) VALUES ('0002_projects.sql');`)
      ledger.push({ id: 2, name: '0002_projects.sql' })
    })
    const readLedger = vi.fn(async () => [...ledger])

    try {
      await writeFile(join(directory, '0001_first.sql'), 'CREATE TABLE first(id INTEGER);')
      await writeFile(join(directory, '0002_projects.sql'), 'CREATE TABLE projects(id INTEGER);')

      await migrateRemote(
        {
          config: 'wrangler.test.toml',
          database: 'test-db',
          migrationsDir: directory,
        },
        { executeCommand, executeImport, readLedger },
      )

      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ database: 'test-db' }),
        MIGRATIONS_TABLE_SQL,
      )
      expect(executeImport).toHaveBeenCalledTimes(1)
      expect(readLedger).toHaveBeenCalled()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails closed when an import fails without a matching committed ledger row', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spool-d1-failure-test-'))
    const failure = new Error('remote import failed')
    try {
      await writeFile(join(directory, '0001_first.sql'), 'CREATE TABLE first(id INTEGER);')
      await expect(
        migrateRemote(
          {
            config: 'wrangler.test.toml',
            database: 'test-db',
            migrationsDir: directory,
          },
          {
            executeCommand: vi.fn(async () => [{ results: [], success: true }]),
            executeImport: vi.fn(async () => {
              throw failure
            }),
            readLedger: vi.fn(async () => []),
          },
        ),
      ).rejects.toBe(failure)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('does not import when the ledger is already current', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spool-d1-current-test-'))
    const executeImport = vi.fn()
    try {
      await writeFile(join(directory, '0001_first.sql'), 'CREATE TABLE first(id INTEGER);')
      await migrateRemote(
        {
          config: 'wrangler.test.toml',
          database: 'test-db',
          migrationsDir: directory,
        },
        {
          executeCommand: vi.fn(async () => [{ results: [], success: true }]),
          executeImport,
          readLedger: vi.fn(async () => [{ id: 1, name: '0001_first.sql' }]),
        },
      )
      expect(executeImport).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('reconciles an ambiguous failure when the ledger proves the import committed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spool-d1-reconcile-test-'))
    const ledger: Array<{ id: number; name: string }> = []
    try {
      await writeFile(join(directory, '0001_first.sql'), 'CREATE TABLE first(id INTEGER);')
      await expect(
        migrateRemote(
          {
            config: 'wrangler.test.toml',
            database: 'test-db',
            migrationsDir: directory,
          },
          {
            executeCommand: vi.fn(async () => [{ results: [], success: true }]),
            executeImport: vi.fn(async () => {
              ledger.push({ id: 1, name: '0001_first.sql' })
              throw new Error('connection closed after commit')
            }),
            readLedger: vi.fn(async () => [...ledger]),
          },
        ),
      ).resolves.toBeUndefined()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
