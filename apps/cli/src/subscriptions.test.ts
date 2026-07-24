import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  addSubscription,
  canonicalSubscriptionPath,
  loadSubscriptions,
  removeSubscription,
  saveSubscriptions,
  subscriptionsPath,
} from './subscriptions.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('subscriptions store', () => {
  it('returns no subscriptions when the file does not exist', () => {
    const home = tempDir('spool-subs-')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('round-trips subscriptions under a temporary HOME', () => {
    const home = tempDir('spool-subs-')
    const subscription = {
      path: '/repos/spool',
      visibility: 'provider-default' as const,
      addedAt: '2026-07-24T00:00:00.000Z',
    }
    const savedPath = saveSubscriptions([subscription], { homeDir: home })
    expect(savedPath).toBe(join(home, '.spool', 'subscriptions.json'))
    expect(subscriptionsPath({ homeDir: home })).toBe(savedPath)
    expect(loadSubscriptions({ homeDir: home })).toEqual([subscription])
  })

  it('adds once, updates visibility in place, and removes', () => {
    const home = tempDir('spool-subs-')
    const base = {
      path: '/repos/spool',
      visibility: 'provider-default' as const,
      addedAt: '2026-07-24T00:00:00.000Z',
    }
    expect(addSubscription(base, { homeDir: home }).added).toBe(true)
    expect(addSubscription(base, { homeDir: home }).added).toBe(false)

    const updated = addSubscription({ ...base, visibility: 'link-only' }, { homeDir: home })
    expect(updated.added).toBe(false)
    expect(loadSubscriptions({ homeDir: home })).toEqual([{ ...base, visibility: 'link-only' }])

    expect(removeSubscription('/repos/other', { homeDir: home }).removed).toBe(false)
    expect(removeSubscription('/repos/spool', { homeDir: home }).removed).toBe(true)
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('rejects malformed subscription files with the offending path', () => {
    const home = tempDir('spool-subs-')
    mkdirSync(join(home, '.spool'), { recursive: true })
    writeFileSync(join(home, '.spool', 'subscriptions.json'), '{"subscriptions": [{}]}')
    expect(() => loadSubscriptions({ homeDir: home })).toThrow(/entry 0 has no path/)
  })

  it('canonicalizes relative inputs and rejects files', () => {
    const dir = tempDir('spool-subs-target-')
    const child = join(dir, 'project')
    mkdirSync(child)
    writeFileSync(join(dir, 'file.txt'), 'x')

    expect(canonicalSubscriptionPath('project', dir)).toBe(canonicalSubscriptionPath(child))
    expect(() => canonicalSubscriptionPath(join(dir, 'missing'))).toThrow()
    expect(() => canonicalSubscriptionPath(join(dir, 'file.txt'))).toThrow(/Not a directory/)
  })
})
