import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sequenceRoot } from '@spool-lab/session-kit'

import type { HubFetch } from '../hub/client.js'
import { handleShareCommand } from './share.js'
import { handleResumeCommand } from './resume.js'

// Command-level round trip against an in-memory hub that implements the
// same wire contract as share-backend. `spool share` seeds it, then
// `spool resume` materializes from it into a temp HOME.

const SESSION_UUID = '6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'
const HUB_URL = 'https://hub.test'

interface StoredHead {
  root: string
  count: number
  manifest: string[]
  sig: string | null
  cardJson: string | null
  noteMd: string | null
  lineageJson: string | null
  viewOid: string
  withdrawn?: boolean
}

function makeHub() {
  const objects = new Map<string, string>()
  const sessions = new Map<string, StoredHead>()

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  const fetchImpl: HubFetch = async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const sidMatch = path.match(/^\/api\/hub\/v1\/sessions\/([^/]+)(?:\/(push|head|records|view|withdraw))?$/)

    if (method === 'POST' && path === '/api/hub/v1/objects/batch') {
      const lines = String(init?.body ?? '').split('\n').filter((line) => line.trim() !== '')
      for (const line of lines) {
        const { oid, data } = JSON.parse(line) as { oid: string; data: string }
        objects.set(oid, data)
      }
      return json({ stored: lines.length })
    }

    if (sidMatch) {
      const sid = decodeURIComponent(sidMatch[1] as string)
      const action = sidMatch[2]
      if (method === 'POST' && (action === 'push' || action === 'head')) {
        const body = JSON.parse(String(init?.body)) as StoredHead
        const wanted = [...new Set([...body.manifest, body.viewOid])]
        const missing = wanted.filter((oid) => !objects.has(oid))
        if (action === 'push') return json({ missing })
        if (missing.length > 0) return json({ error: 'CONFLICT', detail: 'objects missing' }, 409)
        sessions.set(sid, body)
        return json({ url: `${HUB_URL}/session/${sid}` })
      }
      const session = sessions.get(sid)
      if (!session) return json({ error: 'NOT_FOUND' }, 404)
      if (session.withdrawn) return json({ error: 'GONE', detail: 'withdrawn' }, 410)
      if (method === 'GET' && action === undefined) {
        return json({
          sid,
          root: session.root,
          count: session.count,
          sig: session.sig,
          noteMd: session.noteMd,
          cardJson: session.cardJson,
          lineageJson: session.lineageJson,
          viewOid: session.viewOid,
          createdAt: 1,
          updatedAt: 1,
          author: { handle: 'author', displayName: 'Author', avatarUrl: null },
        })
      }
      if (method === 'GET' && action === 'records') {
        const from = Number(url.searchParams.get('from') ?? '0')
        const to = Math.min(Number(url.searchParams.get('to') ?? String(session.count)), session.count)
        const lines = session.manifest.slice(from, to).map((oid, index) =>
          JSON.stringify({ i: from + index, oid, data: objects.get(oid) as string }))
        return new Response(lines.join('\n') + (lines.length > 0 ? '\n' : ''), {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        })
      }
    }
    return json({ error: 'NOT_FOUND', detail: `unhandled ${method} ${path}` }, 404)
  }

  return { fetchImpl, objects, sessions }
}

function writeFixtureSession(workspaceRoot: string): string {
  const line = (record: Record<string, unknown>) => JSON.stringify(record)
  const jsonl = [
    line({
      type: 'user', uuid: 'u-1', parentUuid: null, sessionId: 'orig', cwd: workspaceRoot,
      timestamp: '2026-07-16T10:00:00.000Z',
      message: { role: 'user', content: 'rename alpha to beta in the demo file' },
    }),
    line({
      type: 'assistant', uuid: 'u-2', parentUuid: 'u-1', sessionId: 'orig',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: `${workspaceRoot}/src/demo.ts`, old_string: 'alpha', new_string: 'beta' } }] },
    }),
    line({
      type: 'user', uuid: 'u-3', parentUuid: 'u-2', sessionId: 'orig',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { originalFile: 'alpha\nrest\n', oldString: 'alpha', newString: 'beta' },
    }),
    line({
      type: 'assistant', uuid: 'u-4', parentUuid: 'u-3', sessionId: 'orig',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done: renamed alpha to beta.' }] },
    }),
  ].join('\n') + '\n'
  const filePath = join(workspaceRoot, 'session.jsonl')
  writeFileSync(filePath, jsonl, 'utf8')
  return filePath
}

function shareDeps(hub: ReturnType<typeof makeHub>, workspaceRoot: string, filePath: string, home: string) {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    deps: {
      fetch: hub.fetchImpl,
      homeDir: home,
      env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: 'test-token' } as NodeJS.ProcessEnv,
      cwd: workspaceRoot,
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      resolveTarget: () => ({
        provider: 'claude' as const,
        sessionUuid: SESSION_UUID,
        filePath,
        cwd: workspaceRoot,
      }),
    },
  }
}

describe('spool share → spool resume round trip', () => {
  it('shares through the 3-step handshake and resumes into a fresh local session', async () => {
    const hub = makeHub()
    const authorWs = mkdtempSync(join(tmpdir(), 'spool-author-'))
    const authorHome = mkdtempSync(join(tmpdir(), 'spool-author-home-'))
    const filePath = writeFixtureSession(authorWs)
    const share = shareDeps(hub, authorWs, filePath, authorHome)

    const shareExit = await handleShareCommand(undefined, { noEdit: true }, share.deps)
    expect(share.errors).toEqual([])
    expect(shareExit).toBe(0)

    const sid = `claude_${SESSION_UUID}`
    const head = hub.sessions.get(sid)
    expect(head).toBeDefined()
    expect(head?.count).toBe(4)
    expect(head?.root).toBe(await sequenceRoot(head?.manifest ?? []))
    expect(hub.objects.has(head?.viewOid ?? '')).toBe(true)
    for (const oid of head?.manifest ?? []) {
      expect(hub.objects.get(oid)).not.toContain(authorWs)
    }
    expect(share.logs.join('\n')).toContain(`${HUB_URL}/session/${sid}`)

    // Resume on a "different machine": new HOME, new workspace. The
    // workspace is passed through a SYMLINK on purpose — Claude Code
    // names project dirs after the real path (macOS /tmp → /private/tmp),
    // so materialization must resolve it or --resume never finds the file.
    const resumerWs = realpathSync(mkdtempSync(join(tmpdir(), 'spool-resumer-ws-')))
    const resumerHome = mkdtempSync(join(tmpdir(), 'spool-resumer-home-'))
    const aliasWs = join(mkdtempSync(join(tmpdir(), 'spool-alias-')), 'ws-link')
    symlinkSync(resumerWs, aliasWs)
    const logs: string[] = []
    const errors: string[] = []
    const resumeExit = await handleResumeCommand(`${HUB_URL}/session/${sid}`, { workspace: aliasWs }, {
      fetch: hub.fetchImpl,
      homeDir: resumerHome,
      env: {} as NodeJS.ProcessEnv,
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    })
    expect(errors).toEqual([])
    expect(resumeExit).toBe(0)

    const projectDir = join(resumerHome, '.claude', 'projects', resumerWs.replace(/[^a-zA-Z0-9]/g, '-'))
    const files = readdirSync(projectDir)
    expect(files).toHaveLength(1)
    const materialized = readFileSync(join(projectDir, files[0] as string), 'utf8')
    const lines = materialized.trim().split('\n')
    expect(lines).toHaveLength(5)
    expect(materialized).not.toContain('$SPOOL_WS')
    expect(materialized).toContain(`${resumerWs}/src/demo.ts`)
    const newSessionId = (files[0] as string).replace(/\.jsonl$/, '')
    for (const line of lines) {
      const parsed = JSON.parse(line) as { sessionId?: string }
      if (parsed.sessionId !== undefined) expect(parsed.sessionId).toBe(newSessionId)
    }
    const birth = JSON.parse(lines[4] as string) as { message: { content: [{ text: string }] }; parentUuid: string }
    expect(birth.parentUuid).toBe('u-4')
    expect(birth.message.content[0].text).toContain('<spool-resume-note>')
    expect(logs.join('\n')).toContain(`claude --resume ${newSessionId}`)
  })

  it('aborts the share when the redact gate finds secrets and the user declines', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-secret-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-secret-home-'))
    const jsonl = JSON.stringify({
      type: 'user', uuid: 'u-1', sessionId: 'orig',
      message: { role: 'user', content: 'my key is AKIAABCDEFGHIJKLMNOP and secret stuff' },
    }) + '\n'
    const filePath = join(ws, 'session.jsonl')
    writeFileSync(filePath, jsonl, 'utf8')
    const share = shareDeps(hub, ws, filePath, home)

    const exit = await handleShareCommand(undefined, { noEdit: true }, {
      ...share.deps,
      confirm: async () => false,
    })
    expect(exit).toBe(1)
    expect(share.errors.join('\n')).toContain('Share aborted')
    expect(hub.sessions.size).toBe(0)
    expect(share.logs.join('\n')).toContain('high-severity')
  })

  it('fails resume when a record does not match its oid', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-tamper-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-tamper-home-'))
    const filePath = writeFixtureSession(ws)
    const share = shareDeps(hub, ws, filePath, home)
    expect(await handleShareCommand(undefined, { noEdit: true }, share.deps)).toBe(0)

    const sid = `claude_${SESSION_UUID}`
    const head = hub.sessions.get(sid) as StoredHead
    hub.objects.set(head.manifest[0] as string, '{"tampered":true}')

    const errors: string[] = []
    const exit = await handleResumeCommand(`${HUB_URL}/session/${sid}`, { workspace: ws }, {
      fetch: hub.fetchImpl,
      homeDir: home,
      env: {} as NodeJS.ProcessEnv,
      log: () => {},
      error: (message: string) => errors.push(message),
    })
    expect(exit).toBe(1)
    expect(errors.join('\n')).toContain('Integrity check failed')
  })

  it('reports a withdrawn session distinctly on resume', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-gone-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-gone-home-'))
    const filePath = writeFixtureSession(ws)
    const share = shareDeps(hub, ws, filePath, home)
    expect(await handleShareCommand(undefined, { noEdit: true }, share.deps)).toBe(0)

    const sid = `claude_${SESSION_UUID}`
    ;(hub.sessions.get(sid) as StoredHead).withdrawn = true
    const errors: string[] = []
    const exit = await handleResumeCommand(`${HUB_URL}/session/${sid}`, { workspace: ws }, {
      fetch: hub.fetchImpl,
      homeDir: home,
      env: {} as NodeJS.ProcessEnv,
      log: () => {},
      error: (message: string) => errors.push(message),
    })
    expect(exit).toBe(1)
    expect(errors.join('\n')).toContain('withdrawn')
  })
})
