// Vitest setup file — runs before any test file imports.
//
// @spool-lab/core captures `SPOOL_DIR = process.env.SPOOL_DATA_DIR ??
// ~/.spool` at module-load time. Without this setup, a top-level
// `import { … } from '@spool-lab/core'` in a test file would cause
// SPOOL_DIR to resolve to the real user home (~/.spool), and any
// test that exercises securityPreferences / IPC would silently
// read/write the user's production files.
//
// We allocate one shared tmp dir for the whole test run. Individual
// test files that need their own subdir can append to SPOOL_DATA_DIR
// in `beforeAll`.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env['SPOOL_DATA_DIR']) {
  process.env['SPOOL_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'spool-vitest-'))
}
