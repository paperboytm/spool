// Deploy-shape guard for the companion Worker (workers/spool-share-deletion).
//
// The sweep logic is unit-tested in deletion-worker.test.ts; what has no
// other coverage is the deploy shell itself — the re-export path from the
// Worker package to this backend file, and the wrangler.toml binding set.
// Both fail silently in production if they drift (a moved file bundles to
// an empty Worker; a missing binding turns the sweep into per-run errors),
// so they get pinned here, in a suite CI already runs.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { DELETION_BINDING_NAMES } from '../functions/_scheduled/deletion-worker'

const WORKER_DIR = fileURLToPath(
  new URL('../../../workers/spool-share-deletion/', import.meta.url).href,
)

describe('spool-share-deletion deploy shape', () => {
  it('the Worker entry re-exports a scheduled handler', async () => {
    const shell = (await import('../../../workers/spool-share-deletion/src/worker')) as {
      default?: { scheduled?: unknown }
    }
    expect(typeof shell.default?.scheduled).toBe('function')
  })

  it.each(['wrangler.toml', 'wrangler.prod.toml'])(
    '%s declares exactly the bindings DeletionEnv needs',
    (configName) => {
      const toml = readFileSync(join(WORKER_DIR, configName), 'utf8')
      const bindings = [...toml.matchAll(/^binding = "(\w+)"$/gm)].map((m) => m[1])
      expect(new Set(bindings)).toEqual(new Set(DELETION_BINDING_NAMES))
    },
  )

  it('wrangler.toml keeps the cron and the entry path', () => {
    const toml = readFileSync(join(WORKER_DIR, 'wrangler.toml'), 'utf8')
    expect(toml).toMatch(/^crons = \["0 \*\/6 \* \* \*"\]$/m)
    expect(toml).toMatch(/^main = "src\/worker\.ts"$/m)
    // Resource names are shared with the backend's Pages bindings — a
    // rename here would silently point the sweep at empty resources.
    expect(toml).toContain('database_name = "spool-share-db"')
    expect(toml).toContain('bucket_name = "spool-snapshots"')
    expect(toml).toContain('bucket_name = "spool-og"')
    expect(toml).toContain('bucket_name = "spool-avatars"')
    expect(toml).toContain('bucket_name = "spool-hub"')
  })

  it('the production config is deployable without local TODO values', () => {
    const toml = readFileSync(join(WORKER_DIR, 'wrangler.prod.toml'), 'utf8')
    expect(toml).not.toContain('TODO-fill-from-dashboard')
    expect(toml).toContain('database_id = "fa7aa980-e646-4ebe-8c2f-bf5d5d30ab9d"')
    expect(toml).toContain('id = "b5f5a1ad9f3e456cbdbdc7c7125c4dec"')
    expect(toml).toContain('bucket_name = "spool-hub"')
  })
})
