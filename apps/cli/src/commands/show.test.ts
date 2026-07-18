import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canonicalizeRecord, sequenceRoot } from '@spool-lab/session-kit'
import { describe, expect, it } from 'vite-plus/test'

import type { HubFetch } from '../hub/client.js'
import { handleShowCommand, parseShowRef } from './show.js'

const SID = 'claude_6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'
const HUB_URL = 'https://hub.test'

describe('parseShowRef', () => {
  it('classifies uuids, sids, urls, and @r anchors', () => {
    expect(parseShowRef('abc-123').kind).toBe('local')
    expect(parseShowRef('abc-123@r7')).toMatchObject({
      kind: 'local',
      uuid: 'abc-123',
      recordIndex: 7,
    })
    expect(parseShowRef(SID)).toMatchObject({ kind: 'hub' })
    expect(parseShowRef(`${SID}@r3`)).toMatchObject({ kind: 'hub', recordIndex: 3 })
    expect(parseShowRef(`${HUB_URL}/session/${SID}@r2`)).toMatchObject({
      kind: 'hub',
      recordIndex: 2,
    })
  })
})

const RECORDS = [
  {
    type: 'user',
    uuid: 'u-1',
    sessionId: 's',
    timestamp: '2026-07-16T10:00:00.000Z',
    message: { role: 'user', content: 'rename alpha to beta' },
  },
  {
    type: 'assistant',
    uuid: 'u-2',
    parentUuid: 'u-1',
    sessionId: 's',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'Edit',
          input: { file_path: '/ws/src/a.ts', old_string: 'alpha', new_string: 'beta' },
        },
      ],
    },
  },
  {
    type: 'user',
    uuid: 'u-3',
    parentUuid: 'u-2',
    sessionId: 's',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    toolUseResult: { originalFile: 'alpha\nkeep\n', oldString: 'alpha', newString: 'beta' },
  },
  {
    type: 'assistant',
    uuid: 'u-4',
    parentUuid: 'u-3',
    sessionId: 's',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Renamed alpha to beta.' }] },
  },
]

async function makeHubFixture() {
  const { deriveView } = await import('@spool-lab/session-kit')
  const canonical = await Promise.all(
    RECORDS.map((record) => canonicalizeRecord(JSON.stringify(record), { workspaceRoot: '/ws' })),
  )
  const manifest = canonical.map((record) => record.oid)
  const view = deriveView(canonical, { provider: 'claude' })
  const meta = {
    sid: SID,
    root: await sequenceRoot(manifest),
    count: canonical.length,
    sig: null,
    noteMd: 'why I shared this',
    cardJson: '{"branch":"main","head":"abc123def"}',
    lineageJson: null,
    viewOid: 'v'.repeat(64),
    createdAt: 1,
    updatedAt: 1,
    author: { handle: 'xy', displayName: 'XY', avatarUrl: null },
  }

  const fetchImpl: HubFetch = async (input) => {
    const url = new URL(String(input))
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.pathname === `/api/hub/v1/sessions/${SID}`) return json(meta)
    if (url.pathname === `/api/hub/v1/sessions/${SID}/view`) return json(view)
    if (url.pathname === `/api/hub/v1/sessions/${SID}/records`) {
      const from = Number(url.searchParams.get('from') ?? '0')
      const to = Math.min(
        Number(url.searchParams.get('to') ?? String(canonical.length)),
        canonical.length,
      )
      const lines = canonical
        .slice(from, to)
        .map((record, index) =>
          JSON.stringify({ i: from + index, oid: record.oid, data: record.data }),
        )
      return new Response(lines.join('\n') + '\n', {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }
    return json({ error: 'NOT_FOUND' }, 404)
  }
  return { fetchImpl }
}

function deps(fetchImpl: HubFetch) {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    deps: {
      fetch: fetchImpl,
      env: { SPOOL_HUB_URL: HUB_URL } as NodeJS.ProcessEnv,
      homeDir: mkdtempSync(join(tmpdir(), 'spool-show-home-')),
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  }
}

describe('spool show against the hub', () => {
  it('prints the first-screen summary by default', async () => {
    const hub = await makeHubFixture()
    const d = deps(hub.fetchImpl)
    expect(await handleShowCommand(SID, {}, d.deps)).toBe(0)
    const out = d.logs.join('\n')
    expect(out).toContain('@xy · 4 records')
    expect(out).toContain('why I shared this')
    expect(out).toContain('src/a.ts')
    expect(out).toContain(`spool resume ${SID}`)
  })

  it('--log prints the record timeline from the view', async () => {
    const hub = await makeHubFixture()
    const d = deps(hub.fetchImpl)
    expect(await handleShowCommand(SID, { log: true }, d.deps)).toBe(0)
    const out = d.logs.join('\n')
    expect(out).toContain('#   0  user')
    expect(out).toContain('rename alpha to beta')
    expect(out).toContain('src/a.ts')
  })

  it('--diff recomputes the net change from event records only', async () => {
    const hub = await makeHubFixture()
    const d = deps(hub.fetchImpl)
    expect(await handleShowCommand(SID, { diff: true }, d.deps)).toBe(0)
    const out = d.logs.join('\n')
    expect(out).toContain('── src/a.ts  +1 -1')
    expect(out).toContain('-alpha')
    expect(out).toContain('+beta')
    expect(out).toContain('records #1')
  })

  it('@r<n> lands on one pretty-printed record and rejects out-of-range', async () => {
    const hub = await makeHubFixture()
    const d = deps(hub.fetchImpl)
    expect(await handleShowCommand(`${SID}@r0`, {}, d.deps)).toBe(0)
    expect(d.logs.join('\n')).toContain('"rename alpha to beta"')

    const bad = deps(hub.fetchImpl)
    expect(await handleShowCommand(`${SID}@r99`, {}, bad.deps)).toBe(1)
    expect(bad.errors.join('\n')).toContain('outside the shared range')
  })
})

describe('spool show for local sessions', () => {
  function localTarget() {
    const dir = mkdtempSync(join(tmpdir(), 'spool-show-local-'))
    const filePath = join(dir, 'session.jsonl')
    writeFileSync(
      filePath,
      RECORDS.map((record) => JSON.stringify(record)).join('\n') + '\n',
      'utf8',
    )
    return { provider: 'claude' as const, filePath, workspaceRoot: '/ws', print: () => {} }
  }

  it('--diff composes the net change from the provider file', async () => {
    const d = deps(async () => new Response('{}', { status: 500 }))
    const exit = await handleShowCommand(
      'some-local-uuid',
      { diff: true },
      {
        ...d.deps,
        resolveLocal: () => localTarget(),
      },
    )
    expect(exit).toBe(0)
    const out = d.logs.join('\n')
    expect(out).toContain('── src/a.ts  +1 -1')
  })

  it('@r<n> prints the raw record', async () => {
    const d = deps(async () => new Response('{}', { status: 500 }))
    const exit = await handleShowCommand(
      'some-local-uuid@r3',
      {},
      {
        ...d.deps,
        resolveLocal: () => localTarget(),
      },
    )
    expect(exit).toBe(0)
    expect(d.logs.join('\n')).toContain('Renamed alpha to beta.')
  })

  it('keeps the legacy not-found error', async () => {
    const d = deps(async () => new Response('{}', { status: 500 }))
    const exit = await handleShowCommand(
      'missing-uuid',
      {},
      {
        ...d.deps,
        resolveLocal: () => null,
      },
    )
    expect(exit).toBe(1)
    expect(d.errors.join('\n')).toContain('Session not found: missing-uuid')
  })
})
