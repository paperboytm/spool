import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

const repoRoot = resolve(import.meta.dirname, '../../..')

describe('repository-local spool entrypoint', () => {
  it('defaults pnpm spool to the local Hub without overriding an explicit Hub URL', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const entrypoint = readFileSync(resolve(repoRoot, 'scripts/spool-local.mjs'), 'utf8')

    expect(packageJson.scripts?.['spool']).toBe('node scripts/spool-local.mjs')
    expect(entrypoint).toContain("process.env['SPOOL_HUB_URL'] ||= 'http://localhost:8788'")
    expect(entrypoint).toContain("await import('./ensure-better-sqlite3-node.mjs')")
    expect(entrypoint).toContain("await import('../apps/cli/bin/spool.js')")
  })
})
