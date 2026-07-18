// The protocol keystone: the real CLI (`spool share` / `spool resume`
// handlers) driven against the real hub Pages Functions over the fakes —
// no mocked wire shapes anywhere. What this proves: the CLI's canonical
// records survive zod validation, batch hashing, pack storage, manifest
// folding, the NDJSON read path, and materialize back into a provider
// session on "another machine"; and a reader recomputes the same diff
// from the served records that the author saw locally.

import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { KVNamespace } from '@cloudflare/workers-types'
import { handleResumeCommand } from '@spool-lab/cli/resume'
import { handleShareCommand } from '@spool-lab/cli/share'
import {
  composeSessionDiff,
  extractEditEvents,
  sequenceRoot,
  type SessionViewV1,
} from '@spool-lab/session-kit'
import { describe, expect, it } from 'vite-plus/test'

import { onRequestPost as batchPost } from '../functions/api/hub/v1/objects/batch'
import { onRequestPost as headPost } from '../functions/api/hub/v1/sessions/[sid]/head'
import { onRequestGet as metaGet } from '../functions/api/hub/v1/sessions/[sid]/index'
import { onRequestPost as pushPost } from '../functions/api/hub/v1/sessions/[sid]/push'
import { onRequestGet as recordsGet } from '../functions/api/hub/v1/sessions/[sid]/records'
import { onRequestGet as viewGet } from '../functions/api/hub/v1/sessions/[sid]/view'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2 } from './_helpers/fakes'

const DEV_TOKEN = 'dev-roundtrip-token'
const HUB_URL = 'https://hub.test'
const SESSION_UUID = '6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'
const SID = `claude_${SESSION_UUID}`

function makeEnv() {
  const { db } = makeDb(emptyState())
  const hub = makeR2()
  return {
    DB: db,
    SESSIONS: makeKv() as KVNamespace,
    RATE: makeKv() as KVNamespace,
    HUB: hub.bucket,
    HUB_DEV_TOKEN: DEV_TOKEN,
    PUBLIC_BASE_URL: HUB_URL,
  }
}

type Env = ReturnType<typeof makeEnv>

/** Route absolute hub URLs onto the Pages Function handlers. */
function makeFetchAdapter(env: Env): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const request = new Request(String(input), init)
    const sidMatch = url.pathname.match(
      /^\/api\/hub\/v1\/sessions\/([^/]+)(?:\/(push|head|records|view|withdraw))?$/,
    )
    if (url.pathname === '/api/hub/v1/objects/batch') {
      return invoke(batchPost, request, env)
    }
    if (sidMatch) {
      const params = { sid: decodeURIComponent(sidMatch[1] as string) }
      const action = sidMatch[2]
      if (request.method === 'POST' && action === 'push')
        return invoke(pushPost, request, env, params)
      if (request.method === 'POST' && action === 'head')
        return invoke(headPost, request, env, params)
      if (request.method === 'GET' && action === 'records')
        return invoke(recordsGet, request, env, params)
      if (request.method === 'GET' && action === 'view')
        return invoke(viewGet, request, env, params)
      if (request.method === 'GET' && action === undefined)
        return invoke(metaGet, request, env, params)
    }
    throw new Error(`e2e fetch adapter: unhandled ${request.method} ${url.pathname}`)
  }) as typeof fetch
}

function writeFixtureSession(workspaceRoot: string): string {
  const line = (record: Record<string, unknown>) => JSON.stringify(record)
  const jsonl =
    [
      line({
        type: 'user',
        uuid: 'u-1',
        parentUuid: null,
        sessionId: 'orig',
        cwd: workspaceRoot,
        timestamp: '2026-07-16T10:00:00.000Z',
        message: { role: 'user', content: 'rename alpha to beta across the demo module' },
      }),
      line({
        type: 'assistant',
        uuid: 'u-2',
        parentUuid: 'u-1',
        sessionId: 'orig',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Edit',
              input: {
                file_path: `${workspaceRoot}/src/demo.ts`,
                old_string: 'alpha',
                new_string: 'beta',
              },
            },
          ],
        },
      }),
      line({
        type: 'user',
        uuid: 'u-3',
        parentUuid: 'u-2',
        sessionId: 'orig',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
        },
        toolUseResult: { originalFile: 'alpha\nshared\n', oldString: 'alpha', newString: 'beta' },
      }),
      line({
        type: 'assistant',
        uuid: 'u-4',
        parentUuid: 'u-3',
        sessionId: 'orig',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Renamed alpha to beta; tests pass.' }],
        },
      }),
    ].join('\n') + '\n'
  const filePath = join(workspaceRoot, 'session.jsonl')
  writeFileSync(filePath, jsonl, 'utf8')
  return filePath
}

describe('full-stack round trip: CLI ↔ hub handlers ↔ reader derivation', () => {
  it('share → hub → web-shaped reads → resume, with no mocked wire', async () => {
    const env = makeEnv()
    const fetchAdapter = makeFetchAdapter(env)

    // ── Author machine: spool share
    const authorWs = mkdtempSync(join(tmpdir(), 'spool-e2e-author-'))
    const authorHome = mkdtempSync(join(tmpdir(), 'spool-e2e-author-home-'))
    const filePath = writeFixtureSession(authorWs)
    const shareLogs: string[] = []
    const shareErrors: string[] = []
    const shareExit = await handleShareCommand(
      undefined,
      { noEdit: true, yes: true },
      {
        fetch: fetchAdapter,
        homeDir: authorHome,
        env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: DEV_TOKEN } as NodeJS.ProcessEnv,
        cwd: authorWs,
        log: (message) => shareLogs.push(message),
        error: (message) => shareErrors.push(message),
        resolveTarget: () => ({
          provider: 'claude',
          sessionUuid: SESSION_UUID,
          filePath,
          cwd: authorWs,
        }),
      },
    )
    expect(shareErrors).toEqual([])
    expect(shareExit).toBe(0)
    expect(shareLogs.join('\n')).toContain(`${HUB_URL}/session/${SID}`)

    // ── Reader (what the web page does): meta → view → records
    const metaRes = await fetchAdapter(`${HUB_URL}/api/hub/v1/sessions/${SID}`)
    expect(metaRes.status).toBe(200)
    const meta = (await metaRes.json()) as {
      root: string
      count: number
      viewOid: string
      noteMd: string | null
    }
    expect(meta.count).toBe(4)

    const viewRes = await fetchAdapter(`${HUB_URL}/api/hub/v1/sessions/${SID}/view`)
    expect(viewRes.status).toBe(200)
    const view = (await viewRes.json()) as SessionViewV1
    expect(view.files.map((file) => file.path)).toEqual(['src/demo.ts'])
    expect(view.files[0]?.events).toEqual([1, 2])

    const recordsRes = await fetchAdapter(
      `${HUB_URL}/api/hub/v1/sessions/${SID}/records?from=0&to=4`,
    )
    expect(recordsRes.status).toBe(200)
    const lines = (await recordsRes.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { i: number; oid: string; data: string })
    expect(lines.map((line) => line.i)).toEqual([0, 1, 2, 3])

    // Integrity: served records fold to the published root.
    expect(await sequenceRoot(lines.map((line) => line.oid))).toBe(meta.root)

    // Reader-side diff recompute from only the file's event records —
    // the same code path the web diff pane runs.
    const eventRecords = lines
      .filter((line) => view.files[0]?.events.includes(line.i))
      .map((line) => ({ i: line.i, data: line.data }))
    const events = extractEditEvents(eventRecords, { provider: 'claude' })
    const diff = composeSessionDiff(events).files[0]
    expect(diff?.oldText).toBe('alpha\nshared\n')
    expect(diff?.newText).toBe('beta\nshared\n')
    expect(diff?.hunks[0]?.recordIndices).toContain(1)

    // ── "Another machine": spool resume
    // realpath: materialization resolves symlinks (macOS tmpdir lives
    // under /var → /private/var), and the project-dir assertion below
    // must agree with it.
    const resumerWs = realpathSync(mkdtempSync(join(tmpdir(), 'spool-e2e-resumer-')))
    const resumerHome = mkdtempSync(join(tmpdir(), 'spool-e2e-resumer-home-'))
    const resumeErrors: string[] = []
    const spawnCalls: Array<{ cmd: string; args: readonly string[] }> = []
    const fakeSpawn = ((cmd: string, args: readonly string[]) => {
      spawnCalls.push({ cmd, args })
      return { status: 0 }
    }) as unknown as typeof import('node:child_process').spawnSync
    const resumeExit = await handleResumeCommand(
      `${HUB_URL}/session/${SID}`,
      { workspace: resumerWs },
      {
        fetch: fetchAdapter,
        homeDir: resumerHome,
        env: {} as NodeJS.ProcessEnv,
        log: () => {},
        error: (message) => resumeErrors.push(message),
        spawn: fakeSpawn,
      },
    )
    expect(resumeErrors).toEqual([])
    expect(resumeExit).toBe(0)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]?.cmd).toBe('claude')

    const projectDir = join(
      resumerHome,
      '.claude',
      'projects',
      resumerWs.replace(/[^a-zA-Z0-9]/g, '-'),
    )
    const files = readdirSync(projectDir)
    expect(files).toHaveLength(1)
    const materialized = readFileSync(join(projectDir, files[0] as string), 'utf8')
    expect(materialized).toContain(`${resumerWs}/src/demo.ts`)
    expect(materialized).not.toContain(authorWs)
    expect(materialized).not.toContain('$SPOOL_WS')
    expect(materialized.trim().split('\n')).toHaveLength(5)
    expect(materialized).toContain('<spool-resume-note>')
  })

  it('codex: share → hub → resume materializes a date-partitioned rollout', async () => {
    const env = makeEnv()
    const fetchAdapter = makeFetchAdapter(env)
    const authorWs = mkdtempSync(join(tmpdir(), 'spool-e2e-codex-'))
    const authorHome = mkdtempSync(join(tmpdir(), 'spool-e2e-codex-home-'))
    const line = (record: Record<string, unknown>) => JSON.stringify(record)
    const jsonl =
      [
        line({
          timestamp: '2026-07-16T10:00:00Z',
          type: 'session_meta',
          payload: { id: SESSION_UUID, cwd: authorWs },
        }),
        line({
          timestamp: '2026-07-16T10:00:01Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: `fix the demo in ${authorWs}/src/demo.ts` },
        }),
        line({
          timestamp: '2026-07-16T10:00:02Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Fixed.' },
        }),
      ].join('\n') + '\n'
    const filePath = join(authorWs, 'rollout.jsonl')
    writeFileSync(filePath, jsonl, 'utf8')

    const codexSid = `codex_${SESSION_UUID}`
    const exit = await handleShareCommand(
      undefined,
      { noEdit: true, yes: true },
      {
        fetch: fetchAdapter,
        homeDir: authorHome,
        env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: DEV_TOKEN } as NodeJS.ProcessEnv,
        cwd: authorWs,
        log: () => {},
        error: (message) => {
          throw new Error(message)
        },
        resolveTarget: () => ({
          provider: 'codex',
          sessionUuid: SESSION_UUID,
          filePath,
          cwd: authorWs,
        }),
      },
    )
    expect(exit).toBe(0)

    const resumerWs = realpathSync(mkdtempSync(join(tmpdir(), 'spool-e2e-codex-resumer-')))
    const resumerHome = mkdtempSync(join(tmpdir(), 'spool-e2e-codex-home2-'))
    const spawnCalls: Array<{ cmd: string; args: readonly string[] }> = []
    const fakeSpawn = ((cmd: string, args: readonly string[]) => {
      spawnCalls.push({ cmd, args })
      return { status: 0 }
    }) as unknown as typeof import('node:child_process').spawnSync
    const resumeExit = await handleResumeCommand(
      `${HUB_URL}/session/${codexSid}`,
      { workspace: resumerWs },
      {
        fetch: fetchAdapter,
        homeDir: resumerHome,
        env: {} as NodeJS.ProcessEnv,
        log: () => {},
        error: (message) => {
          throw new Error(message)
        },
        spawn: fakeSpawn,
      },
    )
    expect(resumeExit).toBe(0)
    expect(spawnCalls[0]?.cmd).toBe('codex')
    expect(spawnCalls[0]?.args[0]).toBe('fork')

    // Date-partitioned rollout location + rewritten identity + birth record.
    const sessionsRoot = join(resumerHome, '.codex', 'sessions')
    const year = readdirSync(sessionsRoot)[0] as string
    const month = readdirSync(join(sessionsRoot, year))[0] as string
    const day = readdirSync(join(sessionsRoot, year, month))[0] as string
    const files = readdirSync(join(sessionsRoot, year, month, day))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^rollout-.*\.jsonl$/)
    const materialized = readFileSync(
      join(sessionsRoot, year, month, day, files[0] as string),
      'utf8',
    )
    expect(materialized).toContain(`${resumerWs}/src/demo.ts`)
    expect(materialized).not.toContain(authorWs)
    expect(materialized).not.toContain('$SPOOL_WS')
    expect(materialized).toContain('<spool-resume-note>')
    expect(materialized).not.toContain(`"id":"${SESSION_UUID}"`)
  })

  it('prefix share @2 publishes exactly two records and clamps reads', async () => {
    const env = makeEnv()
    const fetchAdapter = makeFetchAdapter(env)
    const authorWs = mkdtempSync(join(tmpdir(), 'spool-e2e-prefix-'))
    const authorHome = mkdtempSync(join(tmpdir(), 'spool-e2e-prefix-home-'))
    const filePath = writeFixtureSession(authorWs)

    const exit = await handleShareCommand(
      `${SESSION_UUID}@2`,
      { noEdit: true, yes: true },
      {
        fetch: fetchAdapter,
        homeDir: authorHome,
        env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: DEV_TOKEN } as NodeJS.ProcessEnv,
        cwd: authorWs,
        log: () => {},
        error: (message) => {
          throw new Error(message)
        },
        resolveTarget: () => ({
          provider: 'claude',
          sessionUuid: SESSION_UUID,
          filePath,
          cwd: authorWs,
        }),
      },
    )
    expect(exit).toBe(0)

    const metaRes = await fetchAdapter(`${HUB_URL}/api/hub/v1/sessions/${SID}`)
    const meta = (await metaRes.json()) as { count: number }
    expect(meta.count).toBe(2)

    const recordsRes = await fetchAdapter(
      `${HUB_URL}/api/hub/v1/sessions/${SID}/records?from=0&to=999`,
    )
    const lines = (await recordsRes.text()).trim().split('\n')
    expect(lines).toHaveLength(2)
  })
})
