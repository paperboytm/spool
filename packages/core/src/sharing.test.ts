import { parseSessionText } from '@spool-lab/session-kit'
import { describe, expect, it } from 'vite-plus/test'

import { serializeIndexedSession } from './sharing.js'
import type { Message, Session } from './types.js'

describe('serializeIndexedSession', () => {
  it('turns an indexed OpenCode session into portable share records', () => {
    const session = {
      source: 'opencode',
      sessionUuid: 'ses_1234567890abcdef',
      filePath: '/data/opencode.db#session=ses_1234567890abcdef',
      title: 'Portable session',
      cwd: '/workspace',
      model: 'test-model',
      startedAt: '2026-07-19T00:00:00.000Z',
      endedAt: '2026-07-19T00:00:01.000Z',
    } satisfies Pick<
      Session,
      'source' | 'sessionUuid' | 'filePath' | 'title' | 'cwd' | 'model' | 'startedAt' | 'endedAt'
    >
    const messages = [
      {
        msgUuid: null,
        parentUuid: null,
        role: 'user',
        contentText: 'hello from OpenCode',
        timestamp: session.startedAt,
        isSidechain: false,
        toolNames: [],
        seq: 0,
      },
    ] as Message[]

    const parsed = parseSessionText('opencode', serializeIndexedSession(session, messages), 'hub')

    expect(parsed.kind).toBe('parsed')
    if (parsed.kind !== 'parsed') return
    expect(parsed.session.messages[0]).toMatchObject({
      uuid: 'opencode-ses_1234567890abcdef-0',
      contentText: 'hello from OpenCode',
    })
  })
})
