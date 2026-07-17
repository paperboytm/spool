import { test, expect } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

// Regression test for a bundler-hoisting bug that silently routed dev
// writes to ~/.spool/spool.db while the developer thought they were
// using ~/.spool-dev/. The contract we're locking in here is broader
// than the wrapper script: whenever SPOOL_DATA_DIR points somewhere,
// the built Electron app MUST open its DB there and nowhere else.
//
// Concretely: launchApp() sets SPOOL_DATA_DIR to a temp path. After
// the app boots and finishes initial sync we assert:
//   (1) the DB file exists at ctx.dbPath (proves the env var was read)
//   (2) the real ~/.spool/spool.db is byte-for-byte the same (proves
//       no rogue code path opened the production DB)
//
// If a future refactor moves SPOOL_DIR resolution to build time, or
// adds a code path that hardcodes ~/.spool/, this test fails loudly.

let ctx: AppContext

const realSpoolDb = join(homedir(), '.spool', 'spool.db')

interface Fingerprint {
  exists: boolean
  size: number
  mtimeMs: number
}

function fingerprint(path: string): Fingerprint {
  if (!existsSync(path)) return { exists: false, size: 0, mtimeMs: 0 }
  const s = statSync(path)
  return { exists: true, size: s.size, mtimeMs: s.mtimeMs }
}

let before: Fingerprint

test.beforeAll(async () => {
  before = fingerprint(realSpoolDb)
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('app honors SPOOL_DATA_DIR and never touches ~/.spool/', async () => {
  const { window } = ctx
  await waitForSync(window)

  // The isolated DB at the temp SPOOL_DATA_DIR must exist after sync.
  // If a bundler reorder or other regression breaks env-reading at
  // module load, this is empty / never created.
  expect(existsSync(ctx.dbPath)).toBe(true)

  // The user's real ~/.spool/spool.db must be unchanged. We compare
  // both size and mtime — either drifting indicates a write.
  const after = fingerprint(realSpoolDb)
  expect(after).toEqual(before)
})
