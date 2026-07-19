import { runMigrations } from '@spool-lab/core'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vite-plus/test'

import { createTextUi, type CliSelectOption, type CliUi } from '../ui.js'
import { handleListCommand } from './list.js'

describe('spool list', () => {
  it('lets an interactive user choose a Session with autocomplete', async () => {
    const db = createSessionDb(2)
    const choices: CliSelectOption<string>[] = []
    const ui = {
      ...createTextUi(),
      interactive: true,
      autocomplete: async (options: { choices: CliSelectOption<string>[] }) => {
        choices.push(...options.choices)
        return options.choices[0]?.value ?? null
      },
    } as CliUi

    const selected = await handleListCommand(
      { limit: '20', all: true },
      { db, ui, limitExplicit: false },
    )

    expect(choices).toHaveLength(2)
    expect(choices[0]?.label).toBe('session-  Session 02')
    expect(choices[0]?.hint).toContain('claude')
    expect(selected).toBe('session-02')
  })

  it('keeps loading Sessions as an interactive user moves down the results', async () => {
    const db = createSessionDb(45)
    const choices: CliSelectOption<string>[] = []
    const ui = {
      ...createTextUi(),
      interactive: true,
      autocomplete: async (options: {
        choices: CliSelectOption<string>[]
        loadMore?: () => { choices: CliSelectOption<string>[]; hasMore: boolean }
      }) => {
        choices.push(...options.choices)
        while (options.loadMore) {
          const page = options.loadMore()
          choices.push(...page.choices)
          if (!page.hasMore) break
        }
        return choices.at(-1)?.value ?? null
      },
    } as unknown as CliUi

    const selected = await handleListCommand(
      { limit: '20', all: true },
      { db, ui, limitExplicit: false },
    )

    expect(choices).toHaveLength(45)
    expect(choices[0]?.label).toBe('session-  Session 45')
    expect(choices.at(-1)?.label).toBe('session-  Session 01')
    expect(selected).toBe('session-01')
  })
})

function createSessionDb(count: number): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO projects
      (source_id, slug, display_path, display_name, identity_kind, identity_key)
     VALUES (1, 'pickerel', '/work/pickerel', 'pickerel', 'path', '/work/pickerel')`,
  ).run()
  const insert = db.prepare(
    `INSERT INTO sessions
      (project_id, source_id, session_uuid, file_path, title, started_at, ended_at,
       message_count, has_tool_use, raw_file_mtime)
     VALUES (1, 1, ?, ?, ?, ?, ?, 1, 0, ?)`,
  )
  for (let n = 1; n <= count; n += 1) {
    const id = `session-${String(n).padStart(2, '0')}`
    const timestamp = new Date(Date.UTC(2026, 5, n, 12)).toISOString()
    insert.run(
      id,
      `/sessions/${id}.jsonl`,
      `Session ${String(n).padStart(2, '0')}`,
      timestamp,
      timestamp,
      timestamp,
    )
  }
  return db
}
