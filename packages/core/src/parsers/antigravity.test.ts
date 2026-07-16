import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseAntigravitySession } from './antigravity.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeAntigravityHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-antigravity-parser-'))
  tempDirs.push(dir)
  return dir
}

function makeTranscript(steps: object[]): string {
  return steps.map(s => JSON.stringify(s)).join('\n')
}

function writeHistoryJsonl(cliRoot: string, convId: string, cwd: string | null = '/tmp/project'): void {
  const historyPath = join(cliRoot, 'history.jsonl')
  const entry: Record<string, string> = { conversationId: convId }
  if (cwd) entry.workspace = cwd
  writeFileSync(historyPath, JSON.stringify(entry) + '\n')
}

describe('parseAntigravitySession', () => {
  it('extracts user prompt from <USER_REQUEST> tags', () => {
    const cliRoot = makeAntigravityHome()
    const convId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    writeHistoryJsonl(cliRoot, convId)
    const logsDir = join(cliRoot, 'brain', convId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })

    vi.stubEnv('ANTIGRAVITY_CLI_HOME', cliRoot)

    const filePath = join(logsDir, 'transcript.jsonl')
    writeFileSync(filePath, makeTranscript([
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-06-01T00:00:00Z',
        content: '\u0013command(just build) command(tail) \u0010command(git log)\n<USER_REQUEST>\nHelp me fix the parser\n</USER_REQUEST>',
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-06-01T00:00:30Z',
        content: 'I will inspect the parser implementation.',
        tool_calls: [{ name: 'view_file', args: { AbsolutePath: '/tmp/parser.ts' } }],
      },
    ]))

    const parsed = parseAntigravitySession(filePath)
    expect(parsed).not.toBeNull()
    expect(parsed?.source).toBe('antigravity')
    expect(parsed?.sessionUuid).toBe(convId)
    expect(parsed?.title).toBe('Help me fix the parser')
    expect(parsed?.messages).toHaveLength(2)
    expect(parsed?.messages[0]?.role).toBe('user')
    expect(parsed?.messages[0]?.contentText).toBe('Help me fix the parser')
    expect(parsed?.messages[1]?.role).toBe('assistant')
    expect(parsed?.messages[1]?.toolNames).toEqual(['view_file'])
  })

  it('preserves newlines in user content', () => {
    const cliRoot = makeAntigravityHome()
    const convId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
    writeHistoryJsonl(cliRoot, convId)
    const logsDir = join(cliRoot, 'brain', convId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    vi.stubEnv('ANTIGRAVITY_CLI_HOME', cliRoot)

    const filePath = join(logsDir, 'transcript.jsonl')
    writeFileSync(filePath, makeTranscript([
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-06-01T00:00:00Z',
        content: '<USER_REQUEST>\nLine one\nLine two\nLine three\n</USER_REQUEST>',
      },
    ]))

    const parsed = parseAntigravitySession(filePath)
    expect(parsed?.messages[0]?.contentText).toBe('Line one\nLine two\nLine three')
  })

  it('skips CONVERSATION_HISTORY steps', () => {
    const cliRoot = makeAntigravityHome()
    const convId = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'
    writeHistoryJsonl(cliRoot, convId)
    const logsDir = join(cliRoot, 'brain', convId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    vi.stubEnv('ANTIGRAVITY_CLI_HOME', cliRoot)

    const filePath = join(logsDir, 'transcript.jsonl')
    writeFileSync(filePath, makeTranscript([
      {
        step_index: 0,
        source: 'SYSTEM',
        type: 'CONVERSATION_HISTORY',
        status: 'DONE',
        created_at: '2026-06-01T00:00:00Z',
        content: 'Previous conversation context...',
      },
      {
        step_index: 1,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-06-01T00:00:10Z',
        content: '<USER_REQUEST>\nActual user prompt\n</USER_REQUEST>',
      },
    ]))

    const parsed = parseAntigravitySession(filePath)
    expect(parsed?.messages).toHaveLength(1)
    expect(parsed?.messages[0]?.contentText).toBe('Actual user prompt')
  })

  it('falls back to full content when USER_REQUEST tags are missing', () => {
    const cliRoot = makeAntigravityHome()
    const convId = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'
    writeHistoryJsonl(cliRoot, convId)
    const logsDir = join(cliRoot, 'brain', convId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    vi.stubEnv('ANTIGRAVITY_CLI_HOME', cliRoot)

    const filePath = join(logsDir, 'transcript.jsonl')
    writeFileSync(filePath, makeTranscript([
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-06-01T00:00:00Z',
        content: 'Just a plain text prompt without tags',
      },
    ]))

    const parsed = parseAntigravitySession(filePath)
    expect(parsed?.messages[0]?.contentText).toBe('Just a plain text prompt without tags')
  })

  it('falls back to empty CWD (Loose) when missing in history.jsonl', () => {
    const cliRoot = makeAntigravityHome()
    const convId = 'eeeeeeee-ffff-4aaa-8bbb-cccccccccccc'
    // Write history entry without CWD/workspace to force database fallback
    writeHistoryJsonl(cliRoot, convId, null)
    const logsDir = join(cliRoot, 'brain', convId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    vi.stubEnv('ANTIGRAVITY_CLI_HOME', cliRoot)

    const filePath = join(logsDir, 'transcript.jsonl')
    writeFileSync(filePath, makeTranscript([
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-06-01T00:00:00Z',
        content: 'Testing empty CWD fallback',
      },
    ]))

    const parsed = parseAntigravitySession(filePath)
    expect(parsed?.cwd).toBe('')
  })

  it('skips sessions that are not present in history.jsonl', () => {
    const cliRoot = makeAntigravityHome()
    const convId = 'ffffffff-0000-4111-8222-333333333333'
    const logsDir = join(cliRoot, 'brain', convId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    vi.stubEnv('ANTIGRAVITY_CLI_HOME', cliRoot)

    const filePath = join(logsDir, 'transcript.jsonl')
    writeFileSync(filePath, makeTranscript([
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-06-01T00:00:00Z',
        content: 'Should be skipped since not in history.jsonl',
      },
    ]))

    const result = parseAntigravitySession(filePath)
    expect(result).toBeNull() // parseAntigravitySession returns null for skipped results
  })
})
