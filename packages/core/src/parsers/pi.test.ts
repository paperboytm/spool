import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { decodePiSessionDirSlug, loadPiSession, parsePiSession } from './pi.js'
import { wrapSpoolSystemPrelude } from './spool-prelude.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeSessionFile(
  lines: unknown[],
  fileName = '2026-04-02T09-05-13-662Z_f41a7803-b075-4b88-8d74-f46a3a06f67d.jsonl',
): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-pi-parser-'))
  tempDirs.push(dir)
  const filePath = join(dir, fileName)
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return filePath
}

const HEADER = {
  type: 'session',
  version: 3,
  id: 'f41a7803-b075-4b88-8d74-f46a3a06f67d',
  timestamp: '2026-04-02T09:05:13.662Z',
  cwd: '/Users/someone/work/paperboy',
}

function userMessage(
  id: string,
  parentId: string | null,
  text: string,
  timestamp = '2026-04-02T09:26:58.586Z',
): unknown {
  return {
    type: 'message',
    id,
    parentId,
    timestamp,
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

describe('parsePiSession', () => {
  it('parses a pi v3 session log with header, roles, tools, and model', () => {
    const filePath = makeSessionFile([
      HEADER,
      {
        type: 'thinking_level_change',
        id: '22ea80b9',
        parentId: null,
        timestamp: '2026-04-02T09:05:13.662Z',
        thinkingLevel: 'medium',
      },
      userMessage('e620d41e', '22ea80b9', 'Check the current changes with the review skill'),
      {
        type: 'message',
        id: 'f43df2a0',
        parentId: 'e620d41e',
        timestamp: '2026-04-02T09:27:03.126Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me read the skill file first.' },
            { type: 'text', text: 'Reading the skill file and the diff.' },
            {
              type: 'toolCall',
              id: 'toolu_01',
              name: 'read',
              arguments: { path: '/tmp/SKILL.md' },
            },
            { type: 'toolCall', id: 'toolu_02', name: 'bash', arguments: { command: 'git diff' } },
          ],
          model: 'claude-opus-4-6',
          provider: 'anthropic',
        },
      },
      {
        type: 'message',
        id: 'af547017',
        parentId: 'f43df2a0',
        timestamp: '2026-04-02T09:27:03.144Z',
        message: {
          role: 'toolResult',
          toolCallId: 'toolu_01',
          toolName: 'read',
          content: [{ type: 'text', text: 'secret tool output that must not be indexed' }],
        },
      },
    ])

    const parsed = parsePiSession(filePath)
    expect(parsed?.source).toBe('pi')
    expect(parsed?.sessionUuid).toBe('f41a7803-b075-4b88-8d74-f46a3a06f67d')
    expect(parsed?.cwd).toBe('/Users/someone/work/paperboy')
    expect(parsed?.title).toBe('Check the current changes with the review skill')
    expect(parsed?.model).toBe('claude-opus-4-6')
    expect(parsed?.startedAt).toBe('2026-04-02T09:05:13.662Z')
    expect(parsed?.endedAt).toBe('2026-04-02T09:27:03.126Z')

    expect(parsed?.messages).toHaveLength(2)
    expect(parsed?.messages[0]).toMatchObject({
      uuid: 'e620d41e',
      parentUuid: '22ea80b9',
      role: 'user',
      seq: 0,
    })
    expect(parsed?.messages[1]).toMatchObject({
      uuid: 'f43df2a0',
      role: 'assistant',
      contentText: 'Reading the skill file and the diff.',
      toolNames: ['read', 'bash'],
      seq: 1,
    })
    // thinking blocks and toolResult records stay out of the index
    expect(parsed?.messages[1]?.contentText).not.toContain('skill file first')
    expect(parsed?.messages.some((m) => m.contentText.includes('secret tool output'))).toBe(false)
  })

  it('takes the model from model_change when no assistant message names one', () => {
    const filePath = makeSessionFile([
      HEADER,
      {
        type: 'model_change',
        id: '2b5773cc',
        parentId: null,
        timestamp: '2026-04-02T09:05:13.672Z',
        provider: 'anthropic',
        modelId: 'claude-opus-4-8',
      },
      userMessage('e620d41e', '2b5773cc', 'hello'),
    ])

    const parsed = parsePiSession(filePath)
    expect(parsed?.model).toBe('claude-opus-4-8')
  })

  it('strips the spool system prelude from user text', () => {
    const filePath = makeSessionFile([
      HEADER,
      userMessage('e620d41e', null, wrapSpoolSystemPrelude('injected context', 'the real prompt')),
    ])

    const parsed = parsePiSession(filePath)
    expect(parsed?.messages[0]?.contentText).toBe('the real prompt')
    expect(parsed?.title).toBe('the real prompt')
  })

  it('recovers the session uuid from the file name when the header line is missing', () => {
    const filePath = makeSessionFile(
      [userMessage('e620d41e', null, 'orphan session')],
      '2026-04-05T06-40-22-023Z_cf09dc76-3e11-48be-aacd-b1f4b7e06232.jsonl',
    )

    const parsed = parsePiSession(filePath)
    expect(parsed?.sessionUuid).toBe('cf09dc76-3e11-48be-aacd-b1f4b7e06232')
    expect(parsed?.startedAt).toBe('2026-04-02T09:26:58.586Z')
  })

  it('skips sessions with no indexable messages', () => {
    const filePath = makeSessionFile([
      HEADER,
      {
        type: 'thinking_level_change',
        id: '22ea80b9',
        parentId: null,
        timestamp: '2026-04-02T09:05:13.662Z',
        thinkingLevel: 'medium',
      },
    ])

    expect(loadPiSession(filePath)).toEqual({ kind: 'skipped' })
  })

  it('survives malformed lines and string content payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-pi-parser-'))
    tempDirs.push(dir)
    const filePath = join(
      dir,
      '2026-04-02T09-05-13-662Z_f41a7803-b075-4b88-8d74-f46a3a06f67d.jsonl',
    )
    writeFileSync(
      filePath,
      [
        JSON.stringify(HEADER),
        '{broken json',
        JSON.stringify({
          type: 'message',
          id: 'm1',
          parentId: null,
          timestamp: '2026-04-02T09:26:58.586Z',
          message: { role: 'user', content: 'plain string prompt' },
        }),
      ].join('\n') + '\n',
    )

    const parsed = parsePiSession(filePath)
    expect(parsed?.messages).toHaveLength(1)
    expect(parsed?.messages[0]?.contentText).toBe('plain string prompt')
  })
})

describe('decodePiSessionDirSlug', () => {
  it('trims leading and trailing hyphens and decodes the rest to a path', () => {
    expect(decodePiSessionDirSlug('--Users-claw-code-spool--')).toBe('/Users/claw/code/spool')
  })

  it('handles a slug with no surrounding hyphens', () => {
    expect(decodePiSessionDirSlug('Users-claw-code-spool')).toBe('/Users/claw/code/spool')
  })

  it('returns the original slug unchanged when it is all hyphens', () => {
    expect(decodePiSessionDirSlug('----')).toBe('----')
  })

  it('does not hang when a huge hyphen run is not at the very end (ReDoS probe)', () => {
    // The old `/-+$/` regex is only fast when the string genuinely ends in
    // the run it's trimming. When a long hyphen run sits just short of the
    // end (so the anchored match fails and the engine backtracks across
    // every starting position), it degrades polynomially — measured
    // ~3.4s @ 100k hyphens on the pre-fix regex vs. sub-millisecond here.
    const hostile = `-Users-claw${'-'.repeat(100_000)}x`
    const start = Date.now()
    const decoded = decodePiSessionDirSlug(hostile)
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(1_000)
    expect(decoded).toBe(`/Users/claw${'/'.repeat(100_000)}x`)
  })
})
