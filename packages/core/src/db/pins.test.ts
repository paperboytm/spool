import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const tempDirs: string[] = []
const openDbs: Array<{ close: () => void }> = []

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close()
  vi.unstubAllEnvs()
  vi.resetModules()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('pins', () => {
  it('pin + isPinned + unpin roundtrip', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    const uuid = 'sess-1'
    seedSession(uuid, 'Proj', 'Title')

    expect(mod.isPinned(db, uuid)).toBe(false)
    mod.pinSession(db, uuid)
    expect(mod.isPinned(db, uuid)).toBe(true)

    mod.unpinSession(db, uuid)
    expect(mod.isPinned(db, uuid)).toBe(false)
  })

  it('pinSession is idempotent and preserves original pinned_at', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('x', 'P', 'T')
    mod.pinSession(db, 'x')
    const first = db.prepare('SELECT pinned_at FROM pins WHERE session_uuid=?').get('x') as {
      pinned_at: string
    }
    mod.pinSession(db, 'x')
    const second = db.prepare('SELECT pinned_at FROM pins WHERE session_uuid=?').get('x') as {
      pinned_at: string
    }
    expect(second.pinned_at).toBe(first.pinned_at)
  })

  it('getPinnedUuids returns session uuids and filters orphans', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('alive', 'P', 'T')
    mod.pinSession(db, 'alive')
    mod.pinSession(db, 'ghost-session')

    expect(mod.getPinnedUuids(db)).toEqual(['alive'])
  })

  it('unpinSession on non-pinned uuid is a no-op', async () => {
    const mod = await load()
    const { db } = mod
    expect(() => mod.unpinSession(db, 'nobody')).not.toThrow()
  })

  it('preserves session orphans across re-open (transient-absence design)', async () => {
    const spoolDir = makeTempDir('spool-pins-sweep-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)

    const first = await loadInto(spoolDir)
    first.db.prepare('INSERT INTO pins (session_uuid) VALUES (?)').run('ghost-sess')
    first.db.close()
    openDbs.length = 0

    vi.resetModules()
    const second = await loadInto(spoolDir)
    const rows = second.db.prepare('SELECT session_uuid FROM pins').all()
    expect(rows).toEqual([{ session_uuid: 'ghost-sess' }])
  })

  it('persists across a fresh getDB()', async () => {
    const spoolDir = makeTempDir('spool-pins-persist-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)

    const first = await loadInto(spoolDir)
    first.seedSession('persist-uuid', 'P', 'T')
    first.pinSession(first.db, 'persist-uuid')
    first.db.close()
    openDbs.length = 0

    vi.resetModules()
    const second = await loadInto(spoolDir)
    expect(second.isPinned(second.db, 'persist-uuid')).toBe(true)
  })
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function load() {
  const spoolDir = makeTempDir('spool-pins-')
  vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
  return loadInto(spoolDir)
}

async function loadInto(_spoolDir: string) {
  vi.resetModules()
  const dbModule = await import('./db.js')
  const queryModule = await import('./queries.js')
  const db = dbModule.getDB()
  openDbs.push(db)

  function seedSession(sessionUuid: string, projectDisplay: string, title: string): void {
    const sourceId = queryModule.getSourceId(db, 'claude')
    const projectId = queryModule.getOrCreateProject(
      db,
      sourceId,
      projectDisplay.toLowerCase().replace(/\s+/g, '-'),
      `/fake/${projectDisplay}`,
      projectDisplay,
      { identityKind: 'path', identityKey: `/fake/${projectDisplay}` },
    )
    queryModule.upsertSession(db, {
      projectId,
      sourceId,
      sessionUuid,
      filePath: `/fake/${sessionUuid}.jsonl`,
      title,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:10:00Z',
      messageCount: 2,
      hasToolUse: false,
      cwd: '/fake',
      model: 'claude-opus-4-7',
      rawFileMtime: '2026-01-01T00:10:00Z',
    })
  }

  return {
    db,
    pinSession: queryModule.pinSession,
    unpinSession: queryModule.unpinSession,
    isPinned: queryModule.isPinned,
    getPinnedUuids: queryModule.getPinnedUuids,
    seedSession,
  }
}
