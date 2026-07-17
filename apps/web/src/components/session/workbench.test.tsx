import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { HubSessionMeta } from '../../lib/hub-api'
import type { ParsedConversation } from '../../lib/session-messages'
import { SessionWorkbench } from './workbench'

vi.mock('@spool-lab/session-view', () => ({
  MessageList: () => <div data-testid="message-list">Conversation</div>,
}))

const meta: HubSessionMeta = {
  sid: 'claude_test-session',
  root: 'root-oid',
  count: 42,
  sig: null,
  noteMd: '# Why this session\n\nPreserves the architecture decision.',
  cardJson: JSON.stringify({
    remotes: ['github.com/spool-lab/spool'],
    branch: 'feat/workbench',
    head: 'abcdef123456',
    dirty: ['apps/web/src/pages/session-reader.tsx'],
    observed: '2026-07-17T07:00:00.000Z',
  }),
  lineageJson: null,
  viewOid: 'view-oid',
  createdAt: Date.UTC(2026, 6, 17, 6),
  updatedAt: Date.UTC(2026, 6, 17, 7),
  author: { handle: 'dev-user', displayName: 'Dev User', avatarUrl: null },
}

const view: SessionViewV1 = {
  v: 1,
  index: [],
  files: [{ path: 'apps/web/src/session.tsx', events: [4], adds: 12, dels: 3 }],
  outline: [{ i: 3, excerpt: 'Redesign the shared session page' }],
  firstPrompt: 'Redesign the shared session page',
  lastReply: 'Done.',
  diffstat: { files: 1, adds: 12, dels: 3 },
}

const conversation: ParsedConversation = {
  title: 'Redesign the shared session page',
  messages: [{
    id: 0,
    parentUuid: null,
    role: 'user',
    contentText: 'Redesign the shared session page',
    timestamp: '2026-07-17T07:00:00.000Z',
    isSidechain: false,
    toolNames: [],
  }],
  recordToMessageId: new Map([[3, 0]]),
}

function render(overrides: {
  meta?: HubSessionMeta
  view?: SessionViewV1 | null
  conversation?: ParsedConversation
} = {}): string {
  return renderToStaticMarkup(
    <SessionWorkbench
      meta={overrides.meta ?? meta}
      view={overrides.view === undefined ? view : overrides.view}
      provider="claude"
      conversation={overrides.conversation ?? conversation}
      isDark={false}
      fetchRange={async () => []}
      initialRecordIndex={null}
    />,
  )
}

describe('SessionWorkbench', () => {
  it('renders the primary Workbench hierarchy and preserved metadata', () => {
    const html = render()

    expect(html).toContain('<h1 id="sw-workbench-title"')
    expect(html).toContain('Redesign the shared session page</h1>')
    expect(html).toContain('@dev-user')
    expect(html).toContain('Claude Code')
    expect(html).toContain('42 records')
    expect(html).toContain('1 files')
    expect(html).toContain('+12')
    expect(html).toContain('-3')
    expect(html).toContain('Copy resume command')
    expect(html).toContain('Session note')
    expect(html).toContain('<h1>Why this session</h1>')
    expect(html).toContain('Prompts')
    expect(html).toContain('#3')
    expect(html).toContain('Files')
    expect(html).toContain('apps/web/src/session.tsx')
    expect(html).toContain('github.com/spool-lab/spool')
    expect(html).toContain('feat/workbench @ abcdef1 · 1 dirty')
  })

  it('keeps the Workbench usable without note, view, or messages', () => {
    const html = render({
      meta: { ...meta, noteMd: '  ', cardJson: null },
      view: null,
      conversation: { title: '', messages: [], recordToMessageId: new Map() },
    })

    expect(html).toContain('Shared session</h1>')
    expect(html).toContain('Copy resume command')
    expect(html).toContain('No renderable messages in this session.')
    expect(html).not.toContain('Session note')
    expect(html).not.toContain('Prompts')
    expect(html).not.toContain('Files')
    expect(html).not.toContain('Workspace')
  })
})
