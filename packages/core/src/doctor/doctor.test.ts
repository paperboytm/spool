import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

function freshSpoolDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'spool-doctor-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

async function loadRunner(): Promise<typeof import('./runner.js')> {
  vi.resetModules()
  return await import('./runner.js')
}

describe('doctor runner', () => {
  let cleanup: () => void = () => {}

  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    cleanup()
  })

  it('lists every registered check', async () => {
    const { listChecks } = await loadRunner()
    const list = listChecks()
    const ids = list.map((c) => c.id)
    expect(ids).toContain('env.spool-dir')
    expect(ids).toContain('versions.schema-compat')
    expect(ids).toContain('db.exists')
    expect(ids).toContain('native.sqlite')
    expect(ids).toContain('config.agents')
  })

  it('reports no errors against an empty fresh spool dir', async () => {
    const { dir, cleanup: c } = freshSpoolDir()
    cleanup = c
    vi.stubEnv('SPOOL_DATA_DIR', dir)
    const { runChecks } = await loadRunner()
    const results = await runChecks()
    expect(results.filter((r) => r.severity === 'error')).toEqual([])
    expect(results.find((r) => r.id === 'db.exists')?.severity).toBe('warn')
  })

  it('filters to a single check when an id is supplied', async () => {
    const { runChecks } = await loadRunner()
    const results = await runChecks(['env.node-version'])
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('env.node-version')
  })

  it('returns a structured error result instead of throwing when a check explodes', async () => {
    const { dir, cleanup: c } = freshSpoolDir()
    cleanup = c
    // Point SPOOL_DATA_DIR at a *file* path. mkdirSync on that path fails.
    const filePath = join(dir, 'not-a-dir')
    writeFileSync(filePath, 'blocking')
    vi.stubEnv('SPOOL_DATA_DIR', filePath)
    const { runChecks } = await loadRunner()
    const results = await runChecks(['env.spool-dir'])
    expect(results[0]?.severity).toBe('error')
  })

  it('flags malformed agents.json with a destructive fix descriptor', async () => {
    const { dir, cleanup: c } = freshSpoolDir()
    cleanup = c
    writeFileSync(join(dir, 'agents.json'), '{ bad json')
    vi.stubEnv('SPOOL_DATA_DIR', dir)
    const { runChecks } = await loadRunner()
    const results = await runChecks(['config.agents'])
    expect(results[0]?.severity).toBe('error')
    expect(results[0]?.fix?.destructive).toBe(true)
  })

  it('applying the agents.json fix backs up the bad file and writes {}', async () => {
    const { dir, cleanup: c } = freshSpoolDir()
    cleanup = c
    const path = join(dir, 'agents.json')
    writeFileSync(path, '{ bad json')
    vi.stubEnv('SPOOL_DATA_DIR', dir)
    const { runChecks } = await loadRunner()
    const results = await runChecks(['config.agents'])
    const fix = results[0]?.fix
    expect(fix).toBeDefined()
    const result = await fix!.apply()
    expect(result.ok).toBe(true)
    const backup = result.message.match(/at (.+)$/)?.[1]
    expect(backup).toBeDefined()
    expect(statSync(backup!).size).toBeGreaterThan(0)
    expect(statSync(path).size).toBeGreaterThan(0)
  })
})
