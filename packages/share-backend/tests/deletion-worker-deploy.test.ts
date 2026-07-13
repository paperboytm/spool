// Deploy-shape guard for the companion Worker (workers/spool-share-deletion).
//
// The sweep logic is unit-tested in deletion-worker.test.ts; what has no
// other coverage is the deploy shell itself — the re-export path from the
// Worker package to this backend file, and the wrangler.toml binding set.
// Both fail silently in production if they drift (a moved file bundles to
// an empty Worker; a missing binding turns the sweep into per-run errors),
// so they get pinned here, in a suite CI already runs.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DELETION_BINDING_NAMES } from '../functions/_scheduled/deletion-worker'

const WORKER_DIR = new URL('../../../workers/spool-share-deletion/', import.meta.url)

describe('spool-share-deletion deploy shape', () => {
  it('the Worker entry re-exports a scheduled handler', async () => {
    const shell = (await import('../../../workers/spool-share-deletion/src/worker')) as {
      default?: { scheduled?: unknown }
    }
    expect(typeof shell.default?.scheduled).toBe('function')
  })

  it('wrangler.toml declares exactly the bindings DeletionEnv needs', () => {
    const toml = readFileSync(new URL('wrangler.toml', WORKER_DIR), 'utf8')
    const bindings = [...toml.matchAll(/^binding = "(\w+)"$/gm)].map((m) => m[1])
    expect(new Set(bindings)).toEqual(new Set(DELETION_BINDING_NAMES))
  })

  it('wrangler.toml keeps the cron and the entry path', () => {
    const toml = readFileSync(new URL('wrangler.toml', WORKER_DIR), 'utf8')
    expect(toml).toMatch(/^crons = \["0 \*\/6 \* \* \*"\]$/m)
    expect(toml).toMatch(/^main = "src\/worker\.ts"$/m)
    // Resource names are shared with the backend's Pages bindings — a
    // rename here would silently point the sweep at empty resources.
    expect(toml).toContain('database_name = "spool-share-db"')
    expect(toml).toContain('bucket_name = "spool-snapshots"')
    expect(toml).toContain('bucket_name = "spool-og"')
    expect(toml).toContain('bucket_name = "spool-avatars"')
  })
})
