import { describe, expect, it } from 'vite-plus/test'

import { resolveSessionRef } from './ref.js'

const CLAUDE_SID = 'claude_11111111-2222-4333-8444-555555555555'
const CODEX_SID = 'codex_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('resolveSessionRef', () => {
  it.each([
    ['bare sid', CLAUDE_SID, { sid: CLAUDE_SID, provider: 'claude' }],
    [
      'bare sid with position',
      `${CODEX_SID}@42`,
      { sid: CODEX_SID, provider: 'codex', position: 42 },
    ],
    [
      'share URL',
      `https://spool.pro/session/${CLAUDE_SID}`,
      { sid: CLAUDE_SID, provider: 'claude', hubUrl: 'https://spool.pro' },
    ],
    [
      'share URL with position',
      `https://hub.example:8443/session/${CODEX_SID}@7`,
      { sid: CODEX_SID, provider: 'codex', position: 7, hubUrl: 'https://hub.example:8443' },
    ],
  ])('parses a %s', (_label, input, expected) => {
    expect(resolveSessionRef(input)).toEqual(expected)
  })

  it.each([
    '',
    '11111111-2222-4333-8444-555555555555',
    'gemini_11111111-2222-4333-8444-555555555555',
    'claude_not-a-uuid',
    `${CLAUDE_SID}@-1`,
    `${CLAUDE_SID}@1.5`,
    `http://spool.pro/session/${CLAUDE_SID}`,
    `https://spool.pro/s/${CLAUDE_SID}`,
    `https://spool.pro/session/${CLAUDE_SID}?position=1`,
    `https://spool.pro/session/${CLAUDE_SID}/extra`,
  ])('rejects bad input: %s', (input) => {
    expect(() => resolveSessionRef(input)).toThrow('Invalid session reference')
  })
})
