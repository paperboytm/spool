import { PassThrough } from 'node:stream'

import { runMigrations } from '@spool-lab/core'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vite-plus/test'

import { createClackUi, createTextUi, type CliSelectOption, type CliUi } from '../ui.js'
import { handleListCommand } from './list.js'

describe('spool list', () => {
  it('asks to share the selected Session and runs the share flow when confirmed', async () => {
    const db = createSessionDb(2)
    const choices: CliSelectOption<string>[] = []
    const confirmations: Array<{ message: string; initialValue?: boolean }> = []
    let shared = ''
    const ui = {
      ...createTextUi(),
      interactive: true,
      autocomplete: async (options: { choices: CliSelectOption<string>[] }) => {
        choices.push(...options.choices)
        return options.choices[0]?.value ?? null
      },
      confirm: async (message: string, initialValue?: boolean) => {
        confirmations.push({ message, initialValue })
        return true
      },
    } as CliUi

    const exit = await handleListCommand(
      { limit: '20', all: true },
      {
        db,
        ui,
        limitExplicit: false,
        shareSession: async (sessionUuid: string) => {
          shared = sessionUuid
          return 0
        },
      },
    )

    expect(choices).toHaveLength(2)
    expect(choices[0]?.label).toBe('00000002  Session 02')
    expect(choices[0]?.hint).toContain('claude')
    expect(confirmations).toEqual([
      {
        message: 'Publish Session 00000002 as Public? It can appear in Explore and search.',
        initialValue: true,
      },
    ])
    expect(shared).toBe('00000002-0000-4000-8000-000000000002')
    expect(exit).toBe(0)
  })

  it('keeps loading Sessions as an interactive user moves down the results', async () => {
    const db = createSessionDb(45)
    const choices: CliSelectOption<string>[] = []
    const outcomes: string[] = []
    let shared = false
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
      confirm: async () => false,
      outro: (message: string) => outcomes.push(message),
    } as unknown as CliUi

    const exit = await handleListCommand(
      { limit: '20', all: true },
      {
        db,
        ui,
        limitExplicit: false,
        shareSession: async () => {
          shared = true
          return 0
        },
      },
    )

    expect(choices).toHaveLength(45)
    expect(choices[0]?.label).toBe('00000045  Session 45')
    expect(choices.at(-1)?.label).toBe('00000001  Session 01')
    expect(shared).toBe(false)
    expect(outcomes).toEqual(['Session not shared.'])
    expect(exit).toBe(0)
  })

  it('discloses Link-only visibility for a provider outside Explore', async () => {
    const db = createSessionDb(1)
    const pi = db.prepare("SELECT id FROM sources WHERE name='pi'").get() as { id: number }
    db.prepare('UPDATE sessions SET source_id=?').run(pi.id)
    const confirmations: string[] = []
    const ui = {
      ...createTextUi(),
      interactive: true,
      autocomplete: async (options: { choices: CliSelectOption<string>[] }) =>
        options.choices[0]?.value ?? null,
      confirm: async (message: string) => {
        confirmations.push(message)
        return false
      },
    } as CliUi

    await handleListCommand({ limit: '20', all: true }, { db, ui })

    expect(confirmations).toEqual([
      'Share Session 00000001 as Link-only? Anyone with the URL can read it.',
    ])
  })

  it('finds a Session beyond the first page without scanning each intervening page', async () => {
    const db = createSessionDb(45)
    const input = new PassThrough()
    const output = new PassThrough()
    const confirmations: string[] = []
    const ui = {
      ...createClackUi({ input, output, interactive: true }),
      confirm: async (message: string) => {
        confirmations.push(message)
        return false
      },
    } as CliUi

    const result = handleListCommand({ limit: '20', all: true }, { db, ui, limitExplicit: false })
    input.write('Session 01')
    input.write('\r')

    await expect(result).resolves.toBe(0)
    expect(confirmations).toEqual([
      'Publish Session 00000001 as Public? It can appear in Explore and search.',
    ])
  })

  it('cancels cleanly without starting Share when the confirmation is dismissed', async () => {
    const db = createSessionDb(1)
    const outcomes: string[] = []
    let shared = false
    const ui = {
      ...createTextUi(),
      interactive: true,
      autocomplete: async (options: { choices: CliSelectOption<string>[] }) =>
        options.choices[0]?.value ?? null,
      confirm: async () => null,
      cancel: (message: string) => outcomes.push(message),
    } as CliUi

    const exit = await handleListCommand(
      { limit: '20', all: true },
      {
        db,
        ui,
        shareSession: async () => {
          shared = true
          return 0
        },
      },
    )

    expect(shared).toBe(false)
    expect(outcomes).toEqual(['Session not shared.'])
    expect(exit).toBe(0)
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
    const id = `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
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
