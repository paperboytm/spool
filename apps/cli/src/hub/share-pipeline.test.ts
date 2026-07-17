import { describe, expect, it } from 'vitest'
import { canonicalizeRecord, sequenceRoot } from '@spool-lab/session-kit'

import { buildBirthText, extractBirthPayload, type BirthPayload } from './birth.js'
import { materializeClaudeSession, materializeCodexSession, restorePlaceholders } from './materialize.js'
import { prepareShare } from './share-pipeline.js'

const WS = '/Users/author/work/demo'
const HOME = '/Users/author'

function claudeLine(record: Record<string, unknown>): string {
  return JSON.stringify(record)
}

function fixtureJsonl(): string {
  return [
    claudeLine({
      type: 'user',
      uuid: 'u-1',
      parentUuid: null,
      sessionId: 'orig-session',
      timestamp: '2026-07-16T10:00:00.000Z',
      cwd: WS,
      message: { role: 'user', content: 'rename alpha to beta please' },
    }),
    claudeLine({
      type: 'assistant',
      uuid: 'u-2',
      parentUuid: 'u-1',
      sessionId: 'orig-session',
      timestamp: '2026-07-16T10:00:05.000Z',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Edit',
          input: { file_path: `${WS}/src/a.ts`, old_string: 'alpha', new_string: 'beta' },
        }],
      },
    }),
    claudeLine({
      type: 'user',
      uuid: 'u-3',
      parentUuid: 'u-2',
      sessionId: 'orig-session',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { originalFile: 'alpha\nkeep\n', oldString: 'alpha', newString: 'beta' },
    }),
    claudeLine({
      type: 'assistant',
      uuid: 'u-4',
      parentUuid: 'u-3',
      sessionId: 'orig-session',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Renamed alpha to beta.' }] },
    }),
  ].join('\n') + '\n'
}

describe('prepareShare', () => {
  it('canonicalizes, rewrites paths, folds the root, and derives the view', async () => {
    const prepared = await prepareShare({
      provider: 'claude',
      sessionUuid: 'abc-123',
      jsonl: fixtureJsonl(),
      workspaceRoot: WS,
      homeDir: HOME,
    })

    expect(prepared.sid).toBe('claude_abc-123')
    expect(prepared.count).toBe(4)
    expect(prepared.root).toBe(await sequenceRoot(prepared.manifest))
    // The workspace path must be gone from every canonical record.
    for (const record of prepared.records) {
      expect(record.data).not.toContain(WS)
    }
    expect(prepared.records[1]?.data).toContain('$SPOOL_WS/src/a.ts')
    expect(prepared.view.files.map((file) => file.path)).toEqual(['src/a.ts'])
    expect(prepared.view.firstPrompt).toContain('rename alpha')
    expect(prepared.view.lastReply).toContain('Renamed alpha')
    expect(prepared.lineageJson).toBeNull()

    // Wire invariant: the view uploads as canonical bytes matching viewOid.
    const reCanonical = await canonicalizeRecord(prepared.viewData)
    expect(reCanonical.oid).toBe(prepared.viewOid)
  })

  it('prefix share @n takes exactly the first n records', async () => {
    const full = await prepareShare({
      provider: 'claude', sessionUuid: 's', jsonl: fixtureJsonl(), workspaceRoot: WS, homeDir: HOME,
    })
    const prefix = await prepareShare({
      provider: 'claude', sessionUuid: 's', jsonl: fixtureJsonl(), position: 2, workspaceRoot: WS, homeDir: HOME,
    })
    expect(prefix.count).toBe(2)
    expect(prefix.manifest).toEqual(full.manifest.slice(0, 2))
    expect(prefix.root).not.toBe(full.root)
    await expect(prepareShare({
      provider: 'claude', sessionUuid: 's', jsonl: fixtureJsonl(), position: 99, workspaceRoot: WS, homeDir: HOME,
    })).rejects.toThrow(/out of range/)
  })
})

describe('materialize → share lineage round-trip', () => {
  const birth: BirthPayload = {
    source: { sid: 'claude_abc-123', position: 4, url: 'https://spool.pro/session/claude_abc-123' },
  }

  it('materializes with rewritten sessionId, restored paths, and one birth record', async () => {
    const prepared = await prepareShare({
      provider: 'claude', sessionUuid: 'abc-123', jsonl: fixtureJsonl(), workspaceRoot: WS, homeDir: HOME,
    })
    const localWs = '/home/resumer/checkout'
    const materialized = materializeClaudeSession({
      records: prepared.records.map((record, i) => ({ i, data: record.data })),
      sessionId: 'new-session-id',
      workspaceRoot: localWs,
      homeDir: '/home/resumer',
      birth,
      cardJson: '{"branch":"main"}',
      now: new Date('2026-07-16T12:00:00.000Z'),
    })

    expect(materialized.lines).toHaveLength(5)
    expect(materialized.dirSegments).toEqual(['.claude', 'projects', '-home-resumer-checkout'])
    expect(materialized.fileName).toBe('new-session-id.jsonl')
    expect(materialized.resumeArgv).toEqual(['claude', '--resume', 'new-session-id', '--fork-session'])
    for (const line of materialized.lines) {
      expect(line).not.toContain('$SPOOL_WS')
      expect(line).not.toContain('orig-session')
    }
    const first = JSON.parse(materialized.lines[0] as string) as { sessionId: string; cwd: string }
    expect(first.sessionId).toBe('new-session-id')
    expect(first.cwd).toBe(localWs)

    const birthLine = JSON.parse(materialized.lines[4] as string) as {
      type: string
      parentUuid: string
      sessionId: string
      message: { content: [{ text: string }] }
    }
    expect(birthLine.type).toBe('user')
    expect(birthLine.parentUuid).toBe('u-4')
    expect(birthLine.sessionId).toBe('new-session-id')
    expect(birthLine.message.content[0].text).toContain('<spool-resume-note>')
    expect(birthLine.message.content[0].text).toContain('{"branch":"main"}')
  })

  it('materializes a codex session with rewritten session_meta id and one birth record', async () => {
    const codexJsonl = [
      claudeLine({ timestamp: '2026-07-16T10:00:00Z', type: 'session_meta', payload: { id: 'orig-codex', session_id: 'orig-codex', cwd: WS } }),
      claudeLine({ timestamp: '2026-07-16T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-5-codex', cwd: WS } }),
      claudeLine({ timestamp: '2026-07-16T10:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: `rename alpha to beta in ${WS}/src/a.ts` } }),
      claudeLine({ timestamp: '2026-07-16T10:00:03Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Renamed alpha to beta.' } }),
    ].join('\n') + '\n'
    const prepared = await prepareShare({
      provider: 'codex', sessionUuid: 'abc-123', jsonl: codexJsonl, workspaceRoot: WS, homeDir: HOME,
    })
    expect(prepared.sid).toBe('codex_abc-123')

    const localWs = '/home/resumer/checkout'
    const materialized = materializeCodexSession({
      records: prepared.records.map((record, i) => ({ i, data: record.data })),
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      workspaceRoot: localWs,
      homeDir: '/home/resumer',
      birth,
      cardJson: '{"branch":"main"}',
      now: new Date('2026-07-16T12:34:56.789Z'),
    })

    expect(materialized.dirSegments).toEqual(['.codex', 'sessions', '2026', '07', '16'])
    expect(materialized.fileName).toBe('rollout-2026-07-16T12-34-56-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl')
    expect(materialized.resumeArgv).toEqual(['codex', 'fork', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
    expect(materialized.lines).toHaveLength(5)
    for (const line of materialized.lines) {
      expect(line).not.toContain('$SPOOL_WS')
      expect(line).not.toContain('orig-codex')
    }
    const meta = JSON.parse(materialized.lines[0] as string) as { payload: { id: string; session_id: string; cwd: string } }
    expect(meta.payload.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    expect(meta.payload.session_id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    expect(meta.payload.cwd).toBe(localWs)

    const birthLine = JSON.parse(materialized.lines[4] as string) as {
      type: string
      payload: { type: string; role: string; content: [{ type: string; text: string }] }
    }
    expect(birthLine.type).toBe('response_item')
    expect(birthLine.payload.role).toBe('user')
    expect(birthLine.payload.content[0].type).toBe('input_text')
    expect(birthLine.payload.content[0].text).toContain('<spool-resume-note>')

    // Lineage survives a re-share of the materialized codex session.
    const reshared = await prepareShare({
      provider: 'codex',
      sessionUuid: 'def-456',
      jsonl: materialized.lines.join('\n') + '\n',
      workspaceRoot: localWs,
      homeDir: '/home/resumer',
    })
    expect(JSON.parse(reshared.lineageJson as string)).toEqual(birth)
  })

  it('sharing a materialized session extracts its lineage', async () => {
    const prepared = await prepareShare({
      provider: 'claude', sessionUuid: 'abc-123', jsonl: fixtureJsonl(), workspaceRoot: WS, homeDir: HOME,
    })
    const materialized = materializeClaudeSession({
      records: prepared.records.map((record, i) => ({ i, data: record.data })),
      sessionId: 'new-session-id',
      workspaceRoot: '/home/resumer/checkout',
      homeDir: '/home/resumer',
      birth,
      cardJson: null,
    })
    const reshared = await prepareShare({
      provider: 'claude',
      sessionUuid: 'def-456',
      jsonl: materialized.lines.join('\n') + '\n',
      workspaceRoot: '/home/resumer/checkout',
      homeDir: '/home/resumer',
    })
    expect(reshared.lineageJson).not.toBeNull()
    expect(JSON.parse(reshared.lineageJson as string)).toEqual(birth)
  })

  it('extractBirthPayload ignores records without the marker', () => {
    expect(extractBirthPayload([claudeLine({ type: 'user', message: { role: 'user', content: 'hi' } })])).toBeNull()
  })

  it('restorePlaceholders splices JSON-escaped local paths', () => {
    const data = '{"cwd":"$SPOOL_WS","note":"see $SPOOL_HOME/x"}'
    expect(restorePlaceholders(data, '/a/b', '/a')).toBe('{"cwd":"/a/b","note":"see /a/x"}')
    expect(buildBirthText(birth, null)).toContain('conversation-only')
  })
})
