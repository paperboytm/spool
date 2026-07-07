import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseGeminiSession } from './gemini.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeGeminiHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-gemini-parser-'))
  tempDirs.push(dir)
  return dir
}

describe('parseGeminiSession', () => {
  it('parses Gemini chat sessions and resolves the project root from ownership markers', () => {
    const geminiCliHome = makeGeminiHome()
    const geminiHome = join(geminiCliHome, '.gemini')
    const projectRoot = '/tmp/gemini-project'
    const shortId = 'workspace'
    const chatsDir = join(geminiHome, 'tmp', shortId, 'chats')
    const historyDir = join(geminiHome, 'history', shortId)
    mkdirSync(chatsDir, { recursive: true })
    mkdirSync(historyDir, { recursive: true })
    writeFileSync(join(historyDir, '.project_root'), projectRoot)

    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-deadbeef.json')
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'deadbeef-1234-5678-90ab-cdef12345678',
      startTime: '2026-04-08T00:00:00Z',
      lastUpdated: '2026-04-08T00:01:00Z',
      kind: 'main',
      summary: 'Debug the OAuth callback bug',
      messages: [
        {
          id: 'u1',
          timestamp: '2026-04-08T00:00:00Z',
          type: 'user',
          content: [{ text: 'Help me debug the OAuth callback bug' }],
        },
        {
          id: 'a1',
          timestamp: '2026-04-08T00:00:30Z',
          type: 'gemini',
          content: 'I will inspect the auth flow and callback handlers.',
          model: 'gemini-2.5-pro',
          toolCalls: [{ name: 'read_file', displayName: 'ReadFile' }],
        },
      ],
    }))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.source).toBe('gemini')
    expect(parsed?.title).toBe('Debug the OAuth callback bug')
    expect(parsed?.cwd).toBe(projectRoot)
    expect(parsed?.model).toBe('gemini-2.5-pro')
    expect(parsed?.messages).toHaveLength(2)
    expect(parsed?.messages[1]?.toolNames).toEqual(['ReadFile'])
  })

  it('filters subagent sessions from indexing', () => {
    const geminiCliHome = makeGeminiHome()
    const geminiHome = join(geminiCliHome, '.gemini')
    const chatsDir = join(geminiHome, 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-subagent.json')
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'subagent-session',
      kind: 'subagent',
      messages: [
        {
          id: 'a1',
          timestamp: '2026-04-08T00:00:00Z',
          type: 'gemini',
          content: 'Internal helper session',
        },
      ],
    }))

    expect(parseGeminiSession(filePath)).toBeNull()
  })

  it('parses Gemini chat sessions in JSONL format', () => {
    const geminiCliHome = makeGeminiHome()
    const geminiHome = join(geminiCliHome, '.gemini')
    const chatsDir = join(geminiHome, 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-jsonl.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({ sessionId: 'jsonl-session', startTime: '2026-04-08T00:00:00Z', kind: 'main', summary: 'Test JSONL summary' }),
      JSON.stringify({ $set: { messages: [{ id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'user', content: [{ text: 'User prompt' }] }] } }),
      JSON.stringify({ id: 'm2', timestamp: '2026-04-08T00:00:30Z', type: 'gemini', content: 'Gemini answer', model: 'gemini-2.5-flash' })
    ].join('\n'))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.source).toBe('gemini')
    expect(parsed?.title).toBe('Test JSONL summary')
    expect(parsed?.messages).toHaveLength(2)
    expect(parsed?.messages[0]?.role).toBe('user')
    expect(parsed?.messages[0]?.contentText).toBe('User prompt')
    expect(parsed?.messages[1]?.role).toBe('assistant')
    expect(parsed?.messages[1]?.contentText).toBe('Gemini answer')
    expect(parsed?.model).toBe('gemini-2.5-flash')
  })

  it('strips session_context tags and skips messages that contain nothing else', () => {
    const geminiCliHome = makeGeminiHome()
    const geminiHome = join(geminiCliHome, '.gemini')
    const chatsDir = join(geminiHome, 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-context.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({ sessionId: 'context-session', startTime: '2026-04-08T00:00:00Z', kind: 'main' }),
      JSON.stringify({ $set: { messages: [
        { id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'user', content: [{ text: '<session_context>\nSystem info here...\n</session_context>' }] },
        { id: 'm2', timestamp: '2026-04-08T00:00:10Z', type: 'user', content: [{ text: '<session_context>\nSystem info...\n</session_context>\nActual user prompt' }] }
      ] } })
    ].join('\n'))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.source).toBe('gemini')
    expect(parsed?.messages).toHaveLength(1)
    expect(parsed?.messages[0]?.role).toBe('user')
    expect(parsed?.messages[0]?.contentText).toBe('Actual user prompt')
    expect(parsed?.title).toBe('Actual user prompt')
  })

  it('drops the rewound message and everything after it on $rewindTo', () => {
    const geminiCliHome = makeGeminiHome()
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-rewind.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({ sessionId: 'rewind-session', startTime: '2026-04-08T00:00:00Z', kind: 'main' }),
      JSON.stringify({ id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'user', content: [{ text: 'first prompt' }] }),
      JSON.stringify({ id: 'm2', timestamp: '2026-04-08T00:00:10Z', type: 'user', content: [{ text: 'abandoned prompt' }] }),
      JSON.stringify({ id: 'm3', timestamp: '2026-04-08T00:00:20Z', type: 'gemini', content: 'abandoned answer' }),
      JSON.stringify({ $rewindTo: 'm2' }),
      JSON.stringify({ id: 'm4', timestamp: '2026-04-08T00:00:30Z', type: 'user', content: [{ text: 'new prompt' }] }),
    ].join('\n'))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.messages.map(m => m.uuid)).toEqual(['m1', 'm4'])
  })

  it('treats $set.messages as a checkpoint that replaces prior messages', () => {
    const geminiCliHome = makeGeminiHome()
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-checkpoint.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({ sessionId: 'checkpoint-session', startTime: '2026-04-08T00:00:00Z', kind: 'main' }),
      JSON.stringify({ id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'user', content: [{ text: 'kept' }] }),
      JSON.stringify({ id: 'm2', timestamp: '2026-04-08T00:00:10Z', type: 'user', content: [{ text: 'dropped by checkpoint' }] }),
      JSON.stringify({ $set: { messages: [{ id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'user', content: [{ text: 'kept' }] }] } }),
    ].join('\n'))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.messages.map(m => m.uuid)).toEqual(['m1'])
  })

  it('replaces a message when a later snapshot with the same id arrives', () => {
    const geminiCliHome = makeGeminiHome()
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-update.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({ sessionId: 'update-session', startTime: '2026-04-08T00:00:00Z', kind: 'main' }),
      JSON.stringify({ id: 'm1', timestamp: '2026-04-08T00:00:00Z', type: 'gemini', content: 'thinking…', toolCalls: [{ name: 'read_file' }] }),
      // The later snapshot legitimately omits toolCalls — a shallow merge
      // would wrongly keep the stale ones; upstream semantics are replace.
      JSON.stringify({ id: 'm1', timestamp: '2026-04-08T00:00:05Z', type: 'gemini', content: 'final answer' }),
    ].join('\n'))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.messages).toHaveLength(1)
    expect(parsed?.messages[0]?.contentText).toBe('final answer')
    expect(parsed?.messages[0]?.toolNames).toEqual([])
  })
})
