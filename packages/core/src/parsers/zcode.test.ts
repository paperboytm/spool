import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  getZCodeSessionIndexedMtime,
  listZCodeSessionFilePaths,
  loadZCodeSession,
  makeZCodeSessionFilePath,
  normalizeZCodeWatchPath,
} from './zcode.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('ZCode parser', () => {
  it('loads one SQLite-backed ZCode session into Spool messages', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
    } finally {
      db.close()
    }

    const filePath = makeZCodeSessionFilePath(dbPath, 'sess_main')
    const result = loadZCodeSession(filePath)

    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    expect(result.session).toMatchObject({
      source: 'zcode',
      sessionUuid: 'sess_main',
      title: 'Ship the checkout page',
      cwd: '/work/shop',
      model: 'acme/agent-fast',
      startedAt: '2026-05-19T01:00:00.000Z',
      endedAt: '2026-05-19T01:00:04.000Z',
    })
    expect(result.session.messages).toEqual([
      expect.objectContaining({
        uuid: 'msg_user',
        role: 'user',
        contentText: 'Build the checkout page',
        timestamp: '2026-05-19T01:00:01.000Z',
        toolNames: [],
      }),
      expect.objectContaining({
        uuid: 'msg_assistant',
        role: 'assistant',
        contentText: 'I will wire the components.',
        timestamp: '2026-05-19T01:00:02.000Z',
        toolNames: ['grep'],
      }),
    ])
  })

  it('removes complete and incomplete HTML tags from a derived title', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
      db.prepare("UPDATE session SET title = '' WHERE id = 'sess_main'").run()
      db.prepare("UPDATE part SET data = ? WHERE id = 'part_user_text'").run(
        JSON.stringify({ type: 'text', text: '<<script>alert(1)</script>' }),
      )
    } finally {
      db.close()
    }

    const result = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_main'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.title).toBe('alert(1)')
    expect(result.session.title).not.toContain('<')
  })

  it('lists active sessions as synthetic per-session file paths and skips archived ones', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
      db.prepare(`
        INSERT INTO session (id, project_id, slug, directory, title, version, task_type, time_created, time_updated, time_archived)
        VALUES ('sess_archived', 'proj_1', 'archived', '/work/shop', 'Archived', '1.0.0', 'interactive', ?, ?, ?)
      `).run(
        Date.UTC(2026, 4, 19, 1, 0, 0),
        Date.UTC(2026, 4, 19, 1, 0, 5),
        Date.UTC(2026, 4, 19, 1, 0, 6),
      )
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual([
      makeZCodeSessionFilePath(dbPath, 'sess_main'),
    ])
    expect(getZCodeSessionIndexedMtime(makeZCodeSessionFilePath(dbPath, 'sess_main'))).toBe(
      '1779152404000::zcode-v1-session-model',
    )
  })

  it('indexes fork sessions standalone instead of folding them into their parent', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
      // A fork owns a copied history and its own continuation, so it must not
      // fold into the parent like a subagent — indexing both rows is the point.
      insertBareSession(db, {
        id: 'sess_fork',
        parentId: 'sess_main',
        taskType: 'fork',
        title: 'Ship it differently',
        timeUpdated: Date.UTC(2026, 4, 19, 1, 0, 20),
      })
      insertTextMessage(db, {
        sessionId: 'sess_fork',
        messageId: 'msg_fork_user',
        role: 'user',
        text: 'Retry with a form instead',
        at: Date.UTC(2026, 4, 19, 1, 0, 15),
      })
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual(
      expect.arrayContaining([
        makeZCodeSessionFilePath(dbPath, 'sess_main'),
        makeZCodeSessionFilePath(dbPath, 'sess_fork'),
      ]),
    )
    expect(listZCodeSessionFilePaths(dbPath)).toHaveLength(2)

    const result = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_fork'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.title).toBe('Ship it differently')
    expect(result.session.messages.some((m) => m.contentText === 'Retry with a form instead')).toBe(
      true,
    )
  })

  it('folds subagent_child sessions into the root conversation as sidechain messages', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
      seedZCodeSubagent(db)
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual([
      makeZCodeSessionFilePath(dbPath, 'sess_main'),
    ])
    expect(getZCodeSessionIndexedMtime(makeZCodeSessionFilePath(dbPath, 'sess_main'))).toBe(
      '1779152410000::zcode-v1-session-model',
    )

    const childPath = makeZCodeSessionFilePath(dbPath, 'sess_sub_explore')
    expect(loadZCodeSession(childPath)).toEqual({ kind: 'filtered' })

    const result = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_main'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    expect(result.session.endedAt).toBe('2026-05-19T01:00:10.000Z')
    expect(result.session.messages).toEqual([
      expect.objectContaining({
        uuid: 'msg_user',
        role: 'user',
        isSidechain: false,
      }),
      expect.objectContaining({
        uuid: 'msg_assistant',
        role: 'assistant',
        isSidechain: false,
      }),
      expect.objectContaining({
        uuid: 'sess_sub_explore:header',
        role: 'system',
        parentUuid: 'zcode-subagent:sess_sub_explore',
        contentText: 'ZCode subagent: Explore payment routes',
        isSidechain: true,
      }),
      expect.objectContaining({
        uuid: 'sess_sub_explore:msg_child_user',
        role: 'user',
        parentUuid: 'zcode-subagent:sess_sub_explore',
        contentText: 'Inspect payment routes',
        isSidechain: true,
      }),
      expect.objectContaining({
        uuid: 'sess_sub_explore:msg_child_assistant',
        role: 'assistant',
        parentUuid: 'zcode-subagent:sess_sub_explore',
        contentText: 'The handler is in checkout.ts.',
        isSidechain: true,
      }),
    ])
  })

  it('folds nested subagent trees into the root conversation', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
      seedZCodeSubagent(db)
      // Grandchild: a subagent spawned by the explore subagent.
      insertBareSession(db, {
        id: 'sess_grandchild',
        parentId: 'sess_sub_explore',
        taskType: 'subagent_child',
        title: 'Review findings',
      })
      insertTextMessage(db, {
        sessionId: 'sess_grandchild',
        messageId: 'msg_gc',
        role: 'assistant',
        text: 'Looks correct.',
        at: Date.UTC(2026, 4, 19, 1, 0, 12),
      })
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual([
      makeZCodeSessionFilePath(dbPath, 'sess_main'),
    ])

    const result = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_main'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    const grandchild = result.session.messages.find((m) => m.uuid === 'sess_grandchild:msg_gc')
    expect(grandchild).toMatchObject({
      role: 'assistant',
      parentUuid: 'zcode-subagent:sess_grandchild',
      contentText: 'Looks correct.',
      isSidechain: true,
    })
    expect(result.session.messages.some((m) => m.uuid === 'sess_grandchild:header')).toBe(true)
    expect(loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_grandchild'))).toEqual({
      kind: 'filtered',
    })
  })

  it('transfers subagent children when the folded root is a fork', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      seedZCodeSession(db)
      insertBareSession(db, {
        id: 'sess_fork',
        parentId: 'sess_main',
        taskType: 'fork',
        title: 'Variant branch',
      })
      insertTextMessage(db, {
        sessionId: 'sess_fork',
        messageId: 'msg_fork',
        role: 'user',
        text: 'Try the variant',
        at: Date.UTC(2026, 4, 19, 1, 0, 15),
      })
      insertBareSession(db, {
        id: 'sess_fork_sub',
        parentId: 'sess_fork',
        taskType: 'subagent_child',
        title: 'Fork subtask',
      })
      insertTextMessage(db, {
        sessionId: 'sess_fork_sub',
        messageId: 'msg_fork_sub',
        role: 'assistant',
        text: 'Variant confirmed.',
        at: Date.UTC(2026, 4, 19, 1, 0, 18),
      })
    } finally {
      db.close()
    }

    // Root + fork are the two standalone sessions; the fork's subagent folds
    // into the fork, not the original root.
    expect(listZCodeSessionFilePaths(dbPath)).toHaveLength(2)

    const forkResult = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_fork'))
    expect(forkResult.kind).toBe('parsed')
    if (forkResult.kind !== 'parsed') return
    const folded = forkResult.session.messages.find((m) => m.uuid === 'sess_fork_sub:msg_fork_sub')
    expect(folded).toMatchObject({
      contentText: 'Variant confirmed.',
      isSidechain: true,
    })
  })

  it('does not surface a subagent whose parent row is missing', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      insertBareSession(db, {
        id: 'sess_orphan',
        parentId: 'sess_missing_parent',
        taskType: 'subagent_child',
        title: 'Orphaned work',
      })
      insertTextMessage(db, {
        sessionId: 'sess_orphan',
        messageId: 'msg_orphan',
        role: 'user',
        text: 'do the thing',
        at: Date.UTC(2026, 4, 19, 2, 0, 0),
      })
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual([])
    expect(loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_orphan'))).toEqual({
      kind: 'filtered',
    })
  })

  it('keeps a subagent hidden when its parent is archived', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      const start = Date.UTC(2026, 4, 19, 3, 0, 0)
      db.prepare(`
        INSERT INTO session (id, project_id, slug, directory, title, version, task_type, time_created, time_updated, time_archived)
        VALUES ('sess_arch_parent', 'proj_1', 'archived-root', '/work/shop', 'Archived root', '1.0.0', 'interactive', ?, ?, ?)
      `).run(start, start, start + 1)
      insertBareSession(db, {
        id: 'sess_arch_child',
        parentId: 'sess_arch_parent',
        taskType: 'subagent_child',
        title: 'Child of archived',
      })
      insertTextMessage(db, {
        sessionId: 'sess_arch_child',
        messageId: 'msg_ac',
        role: 'user',
        text: 'hidden work',
        at: start + 1000,
      })
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual([])
    expect(loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_arch_child'))).toEqual({
      kind: 'filtered',
    })
  })

  it('does not hang and produces no roots on a self-referential parent_id cycle', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      insertBareSession(db, {
        id: 'sess_cycle_a',
        parentId: 'sess_cycle_b',
        taskType: 'subagent_child',
        title: 'A',
      })
      insertBareSession(db, {
        id: 'sess_cycle_b',
        parentId: 'sess_cycle_a',
        taskType: 'subagent_child',
        title: 'B',
      })
      insertTextMessage(db, {
        sessionId: 'sess_cycle_a',
        messageId: 'msg_a',
        role: 'user',
        text: 'a',
        at: Date.UTC(2026, 4, 19, 4, 0, 0),
      })
      insertTextMessage(db, {
        sessionId: 'sess_cycle_b',
        messageId: 'msg_b',
        role: 'user',
        text: 'b',
        at: Date.UTC(2026, 4, 19, 4, 0, 1),
      })
    } finally {
      db.close()
    }

    expect(listZCodeSessionFilePaths(dbPath)).toEqual([])
    expect(loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_cycle_a'))).toEqual({
      kind: 'filtered',
    })
  })

  it('returns null from parseZCodeSession for a missing database file', async () => {
    const { parseZCodeSession } = await import('./zcode.js')
    const missing = makeZCodeSessionFilePath('/no/such/db.sqlite', 'sess_x')
    expect(parseZCodeSession(missing)).toBeNull()
  })

  it('derives the model from the message data, keeping provider prefix', async () => {
    const { db, dbPath } = createZCodeDb()
    try {
      // Only an assistant message carrying flat modelID/providerID.
      insertBareSession(db, { id: 'sess_model_flat', title: 'Flat model' })
      db.prepare(`
        INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_flat_model', 'sess_model_flat', ?, ?, ?)
      `).run(
        Date.UTC(2026, 4, 19, 1, 0, 6),
        Date.UTC(2026, 4, 19, 1, 0, 6),
        JSON.stringify({ role: 'assistant', modelID: 'agent-fast', providerID: 'acme' }),
      )
      db.prepare(`
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('part_flat_model', 'msg_flat_model', 'sess_model_flat', ?, ?, ?)
      `).run(
        Date.UTC(2026, 4, 19, 1, 0, 6),
        Date.UTC(2026, 4, 19, 1, 0, 6),
        JSON.stringify({ type: 'text', text: 'Done.' }),
      )

      // Model id only, no provider.
      insertBareSession(db, { id: 'sess_model_plain', title: 'Plain model' })
      db.prepare(`
        INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_plain_model', 'sess_model_plain', ?, ?, ?)
      `).run(
        Date.UTC(2026, 4, 19, 1, 0, 7),
        Date.UTC(2026, 4, 19, 1, 0, 7),
        JSON.stringify({ role: 'assistant', modelID: 'agent-solo' }),
      )
      db.prepare(`
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('part_plain_model', 'msg_plain_model', 'sess_model_plain', ?, ?, ?)
      `).run(
        Date.UTC(2026, 4, 19, 1, 0, 7),
        Date.UTC(2026, 4, 19, 1, 0, 7),
        JSON.stringify({ type: 'text', text: 'Done.' }),
      )
    } finally {
      db.close()
    }

    const flat = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_model_flat'))
    expect(flat.kind).toBe('parsed')
    if (flat.kind !== 'parsed') return
    expect(flat.session.model).toBe('acme/agent-fast')

    const plain = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_model_plain'))
    expect(plain.kind).toBe('parsed')
    if (plain.kind !== 'parsed') return
    expect(plain.session.model).toBe('agent-solo')
  })

  it('ignores non-conversation part types like timeline and compaction', () => {
    const { db, dbPath } = createZCodeDb()
    try {
      insertBareSession(db, { id: 'sess_parts', title: 'Part filter' })
      db.prepare(`
        INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_parts', 'sess_parts', ?, ?, ?)
      `).run(
        Date.UTC(2026, 4, 19, 1, 0, 6),
        Date.UTC(2026, 4, 19, 1, 0, 6),
        JSON.stringify({ role: 'assistant' }),
      )
      for (const [id, data] of [
        ['part_timeline', { type: 'timeline', text: 'should not appear' }],
        ['part_compaction', { type: 'compaction', text: 'should not appear' }],
        ['part_reasoning', { type: 'reasoning', text: 'should not appear' }],
        ['part_text', { type: 'text', text: 'Visible reply.' }],
      ] as Array<[string, unknown]>) {
        db.prepare(`
          INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
          VALUES (?, 'msg_parts', 'sess_parts', ?, ?, ?)
        `).run(
          id,
          Date.UTC(2026, 4, 19, 1, 0, 6),
          Date.UTC(2026, 4, 19, 1, 0, 6),
          JSON.stringify(data),
        )
      }
    } finally {
      db.close()
    }

    const result = loadZCodeSession(makeZCodeSessionFilePath(dbPath, 'sess_parts'))
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.messages).toEqual([
      expect.objectContaining({
        uuid: 'msg_parts',
        role: 'assistant',
        contentText: 'Visible reply.',
      }),
    ])
  })

  it('maps WAL/SHM sidecar paths back to the main database file', () => {
    expect(normalizeZCodeWatchPath('/data/zcode/db/db.sqlite-wal')).toBe('/data/zcode/db/db.sqlite')
    expect(normalizeZCodeWatchPath('/data/zcode/db/db.sqlite-shm')).toBe('/data/zcode/db/db.sqlite')
    expect(normalizeZCodeWatchPath('/data/zcode/db/db.sqlite-journal')).toBe(
      '/data/zcode/db/db.sqlite',
    )
    expect(normalizeZCodeWatchPath('/data/zcode/db/db.sqlite')).toBe('/data/zcode/db/db.sqlite')
    expect(normalizeZCodeWatchPath('/data/other/file.jsonl')).toBe('/data/other/file.jsonl')
  })
})

function createZCodeDb(): { db: Database.Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'spool-zcode-parser-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'db.sqlite')
  const db = new Database(dbPath)
  // Minimal shape of the ZCode session store: the real DB carries extra
  // columns (path, workspace_id, summary_*, permission, trace_id, …) that the
  // parser never reads, so the fixture omits them.
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      parent_id text,
      slug text NOT NULL,
      directory text NOT NULL,
      title text NOT NULL,
      version text NOT NULL,
      task_type text NOT NULL DEFAULT 'interactive',
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      time_archived integer
    );

    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );

    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `)
  return { db, dbPath }
}

function seedZCodeSession(db: Database.Database): void {
  const start = Date.UTC(2026, 4, 19, 1, 0, 0)
  db.prepare(`
    INSERT INTO session (id, project_id, slug, directory, title, version, task_type, time_created, time_updated)
    VALUES ('sess_main', 'proj_1', 'ship-checkout-page', '/work/shop', 'Ship the checkout page', '1.0.0', 'interactive', ?, ?)
  `).run(start, start + 4000)

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'sess_main', ?, ?, ?)
  `).run(
    'msg_user',
    start + 1000,
    start + 1000,
    JSON.stringify({
      role: 'user',
      model: { providerID: 'acme', modelID: 'agent-fast' },
      path: { cwd: '/work/shop' },
    }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'sess_main', ?, ?, ?)
  `).run(
    'part_user_text',
    'msg_user',
    start + 1000,
    start + 1000,
    JSON.stringify({ type: 'text', text: 'Build the checkout page' }),
  )

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'sess_main', ?, ?, ?)
  `).run(
    'msg_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ role: 'assistant', modelID: 'agent-fast', providerID: 'acme' }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'sess_main', ?, ?, ?)
  `).run(
    'part_assistant_text',
    'msg_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ type: 'text', text: 'I will wire the components.' }),
  )
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'sess_main', ?, ?, ?)
  `).run(
    'part_assistant_tool',
    'msg_assistant',
    start + 2500,
    start + 2500,
    JSON.stringify({ type: 'tool', tool: 'grep', state: { status: 'completed' } }),
  )
}

function insertBareSession(
  db: Database.Database,
  opts: {
    id: string
    parentId?: string | null
    taskType?: string
    title?: string
    timeUpdated?: number
  },
): void {
  const start = Date.UTC(2026, 4, 19, 1, 0, 6)
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, task_type, time_created, time_updated)
    VALUES (?, 'proj_1', ?, ?, '/work/shop', ?, '1.0.0', ?, ?, ?)
  `).run(
    opts.id,
    opts.parentId ?? null,
    opts.id,
    opts.title ?? opts.id,
    opts.taskType ?? 'interactive',
    start,
    opts.timeUpdated ?? start + 4000,
  )
}

function insertTextMessage(
  db: Database.Database,
  opts: { sessionId: string; messageId: string; role: string; text: string; at: number },
): void {
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(opts.messageId, opts.sessionId, opts.at, opts.at, JSON.stringify({ role: opts.role }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `${opts.messageId}_text`,
    opts.messageId,
    opts.sessionId,
    opts.at,
    opts.at,
    JSON.stringify({ type: 'text', text: opts.text }),
  )
}

function seedZCodeSubagent(db: Database.Database): void {
  const start = Date.UTC(2026, 4, 19, 1, 0, 6)
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, task_type, time_created, time_updated)
    VALUES ('sess_sub_explore', 'proj_1', 'sess_main', 'explore-payment-routes', '/work/shop', 'Explore payment routes', '1.0.0', 'subagent_child', ?, ?)
  `).run(start, start + 4000)

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'sess_sub_explore', ?, ?, ?)
  `).run('msg_child_user', start + 1000, start + 1000, JSON.stringify({ role: 'user' }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'sess_sub_explore', ?, ?, ?)
  `).run(
    'part_child_user_text',
    'msg_child_user',
    start + 1000,
    start + 1000,
    JSON.stringify({ type: 'text', text: 'Inspect payment routes' }),
  )

  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, 'sess_sub_explore', ?, ?, ?)
  `).run('msg_child_assistant', start + 2000, start + 2000, JSON.stringify({ role: 'assistant' }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, 'sess_sub_explore', ?, ?, ?)
  `).run(
    'part_child_assistant_text',
    'msg_child_assistant',
    start + 2000,
    start + 2000,
    JSON.stringify({ type: 'text', text: 'The handler is in checkout.ts.' }),
  )
}
