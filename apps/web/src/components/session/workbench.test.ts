import type { SessionProvider, SessionViewV1 } from '@spool-lab/session-kit'
import type { ConversationMessage } from '@spool-lab/session-view'
import type { SpoolDocument } from '@spool/share-kit'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import type { HubSessionMeta } from '../../lib/hub-api'
import type { ParsedConversation } from '../../lib/session-messages'

vi.mock('@spool-lab/session-view', () => ({
  MessageList: ({ useWindowScroll }: { useWindowScroll?: boolean }) =>
    createElement(
      'div',
      {
        'data-testid': 'message-list',
        'data-window-scroll': String(useWindowScroll === true),
      },
      'Conversation',
    ),
}))

vi.mock('@spool/share-kit/timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spool/share-kit/timeline')>()
  return {
    ...actual,
    TimelineBody: ({ progressive }: { progressive?: boolean }) =>
      createElement(
        'div',
        { 'data-testid': 'timeline-body', 'data-progressive': String(progressive === true) },
        'Shared timeline',
      ),
  }
})

vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 20, 12))

import { SessionWorkbench, getSpoolPromptEntries, getUserPromptEntries } from './workbench'

function message(
  id: number,
  role: ConversationMessage['role'],
  contentText: string,
): ConversationMessage {
  return {
    id,
    parentUuid: null,
    role,
    contentText,
    timestamp: '2026-07-17T07:00:00.000Z',
    isSidechain: false,
    toolNames: [],
  }
}

function spoolDocument(
  turns: SpoolDocument['conversation']['turns'],
  options: { selected?: number[]; hideEmptyTurns?: boolean; redact?: boolean } = {},
): SpoolDocument {
  return {
    version: 2,
    exportedAt: '2026-07-17T07:00:00.000Z',
    conversation: {
      source: 'claude-code',
      sourceLabel: 'Claude Code',
      origin: { kind: 'agent-session', agent: 'claude' },
      title: 'Shared session',
      shareUrl: null,
      createdAt: '2026-07-17T07:00:00.000Z',
      wordCount: 10,
      readMin: 1,
      turns,
    },
    opts: {
      template: 'chat',
      paper: 'snow',
      typeface: 'geist',
      colorway: 'amber',
      accentHex: '#C85A00',
      density: 'compact',
      redact: options.redact ?? false,
      showGaps: true,
      showMasthead: false,
      showColophon: false,
      hideEmptyTurns: options.hideEmptyTurns ?? true,
      ...(options.selected === undefined ? {} : { selected: options.selected }),
    },
  }
}

describe('getUserPromptEntries', () => {
  it('includes only nonblank user messages while preserving their ids and order', () => {
    const entries = getUserPromptEntries([
      message(8, 'assistant', 'I can help with that.'),
      message(13, 'user', '  Redesign the session timeline  '),
      message(21, 'system', 'System context'),
      message(34, 'user', ' \n\t '),
      message(55, 'user', 'Add workspace metadata'),
    ])

    expect(entries).toEqual([
      {
        id: 13,
        excerpt: 'Redesign the session timeline',
        preview: 'Redesign the session timeline',
      },
      { id: 55, excerpt: 'Add workspace metadata', preview: 'Add workspace metadata' },
    ])
  })

  it('uses a trimmed first nonblank line as the prompt excerpt', () => {
    const [entry] = getUserPromptEntries([
      message(89, 'user', '\n   Keep the metadata beside the timeline   \nDo not show this line'),
    ])

    expect(entry).toEqual({
      id: 89,
      excerpt: 'Keep the metadata beside the timeline',
      preview: 'Keep the metadata beside the timeline   \nDo not show this line',
    })
  })

  it('truncates long prompts to a concise single-line excerpt', () => {
    const firstLine = `Explain ${'the session timeline in detail '.repeat(8)}`.trim()
    const [entry] = getUserPromptEntries([
      message(144, 'user', `${firstLine}\nThis second line must not be included.`),
    ])

    expect(entry?.id).toBe(144)
    expect(entry?.excerpt).not.toContain('\n')
    expect(entry?.excerpt.length).toBeLessThan(firstLine.length)
    expect(entry?.excerpt.length).toBeLessThanOrEqual(100)
    expect(firstLine.startsWith(entry?.excerpt.replace(/\u2026$/, '') ?? '')).toBe(true)
    expect(entry?.preview).toContain('This second line must not be included.')
  })

  it('uses the desktop preview cleanup rules for markdown prompt text', () => {
    const entries = getUserPromptEntries([
      message(233, 'user', '\n  ## `Review` the metadata layout  \nMore context'),
    ])

    expect(entries).toEqual([
      {
        id: 233,
        excerpt: 'Review the metadata layout',
        preview: '## `Review` the metadata layout  \nMore context',
      },
    ])
  })
})

describe('getSpoolPromptEntries', () => {
  it('uses original turn indices for visible nonblank user turns', () => {
    const entries = getSpoolPromptEntries(
      spoolDocument([
        { role: 'assistant', body: 'Opening response' },
        { role: 'user', body: '  # First prompt  ' },
        { role: 'user', body: '\n\t' },
        { role: 'assistant', body: 'Follow-up response' },
        { role: 'user', body: 'Second prompt' },
      ]),
    )

    expect(entries).toEqual([
      { turnIndex: 1, excerpt: 'First prompt', preview: '# First prompt' },
      { turnIndex: 4, excerpt: 'Second prompt', preview: 'Second prompt' },
    ])
  })

  it('follows the shared selection projection instead of indexing hidden turns', () => {
    const entries = getSpoolPromptEntries(
      spoolDocument(
        [
          { role: 'user', body: 'Hidden first prompt' },
          { role: 'assistant', body: 'Visible response' },
          { role: 'user', body: 'Visible second prompt' },
          { role: 'user', body: 'Hidden third prompt' },
        ],
        { selected: [1, 2] },
      ),
    )

    expect(entries).toEqual([
      { turnIndex: 2, excerpt: 'Visible second prompt', preview: 'Visible second prompt' },
    ])
  })

  it('never adds a blank user turn to the prompt directory', () => {
    const entries = getSpoolPromptEntries(
      spoolDocument(
        [
          { role: 'user', body: '   ' },
          { role: 'assistant', body: 'Assistant response' },
        ],
        { hideEmptyTurns: false },
      ),
    )

    expect(entries).toEqual([])
  })

  it('uses the same redacted projection as the shared timeline', () => {
    const sensitiveEmail = 'maya@hogwarts.edu'
    const entries = getSpoolPromptEntries(
      spoolDocument([{ role: 'user', body: `Please reply to ${sensitiveEmail}` }], {
        redact: true,
      }),
    )

    expect(entries[0]?.preview).not.toContain(sensitiveEmail)
    expect(entries[0]?.preview).toContain('m***@hogwarts.edu')
  })
})

const meta: HubSessionMeta = {
  sid: 'claude_test-session',
  root: 'root-oid',
  count: 4,
  sig: null,
  summaryMd: '# Purpose\n\nKeep the context readable.',
  cardJson: null,
  lineageJson: null,
  viewOid: 'view-oid',
  spoolFileOid: 'spool-oid',
  createdAt: Date.UTC(2026, 6, 10, 6),
  updatedAt: Date.UTC(2026, 6, 17, 7),
  visibility: 'public',
  cost: null,
  author: { handle: 'dev-user', displayName: 'Dev User', avatarUrl: null },
}

const conversation: ParsedConversation = {
  title: 'Raw title',
  messages: [message(1, 'user', 'Full prompt\nwith more context')],
  recordToMessageId: new Map([[0, 1]]),
}

const view: SessionViewV1 = {
  v: 1,
  index: [],
  files: [{ path: 'apps/web/src/session.tsx', events: [0], adds: 2, dels: 1 }],
  outline: [],
  firstPrompt: 'Full prompt',
  lastReply: 'Done',
  diffstat: { files: 1, adds: 2, dels: 1 },
}

function renderWorkbench(
  options: {
    spool?: SpoolDocument | null
    messages?: ParsedConversation
    summaryMd?: string | null
    cardJson?: string | null
    view?: SessionViewV1 | null
    provider?: SessionProvider
    visibility?: HubSessionMeta['visibility']
    cost?: HubSessionMeta['cost']
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(SessionWorkbench, {
      meta: {
        ...meta,
        summaryMd: options.summaryMd === undefined ? meta.summaryMd : options.summaryMd,
        cardJson: options.cardJson === undefined ? meta.cardJson : options.cardJson,
        visibility: options.visibility ?? meta.visibility,
        cost: options.cost === undefined ? (meta.cost ?? null) : options.cost,
      },
      view: options.view === undefined ? view : options.view,
      provider: options.provider ?? 'claude',
      conversation: options.messages ?? conversation,
      isDark: false,
      initialRecordIndex: null,
      spoolDocument:
        options.spool === undefined
          ? spoolDocument([
              { role: 'user', body: 'Published full prompt\nwith private detail removed' },
            ])
          : options.spool,
    }),
  )
}

describe('SessionWorkbench', () => {
  it('renders the shared progressive timeline and prompt directory', () => {
    const html = renderWorkbench()

    expect(html).toContain('data-testid="timeline-body"')
    expect(html).toContain('data-testid="session-visibility"')
    expect(html).toContain('lucide-earth')
    expect(html).toContain('>Public</span>')
    expect(html).toContain('Published Jul 10, 2026')
    expect(html).toContain('data-progressive="true"')
    expect(html).toContain('Published full prompt')
    expect(html).toContain('<h1>Purpose</h1>')
    expect(html).not.toContain('>Files<')
  })

  it('never falls back to raw metadata when a curated title is blank', () => {
    const document = spoolDocument([{ role: 'user', body: 'Published prompt' }])
    document.conversation.title = '   '
    const html = renderWorkbench({
      spool: document,
      messages: { ...conversation, title: 'Unpublished private title' },
    })

    expect(html).toContain('Shared session')
    expect(html).not.toContain('Unpublished private title')
  })

  it('prefers the front-matter task title, strips it from the Summary, and shows cost', () => {
    const html = renderWorkbench({
      summaryMd:
        '---\ntitle: Fix refresh-token race across tabs\ntitle_zh: 修复跨标签页刷新令牌竞态\n---\n\n## Goal\nStop double refresh.',
      cost: { usd: 3, totalTokens: 1_000_000 },
    })

    // Node has no navigator, so the English title is the deterministic pick.
    expect(html).toContain('Fix refresh-token race across tabs')
    expect(html).toContain('$3.00 · 1M tokens')
    expect(html).toContain('Stop double refresh.')
    // Front-matter never renders as Summary content.
    expect(html).not.toContain('title_zh')
    expect(html).not.toContain('修复跨标签页刷新令牌竞态')
  })

  it('keeps the derived title and omits cost for legacy sessions', () => {
    const html = renderWorkbench({ view })

    expect(html).toContain('Shared session')
    expect(html).not.toContain('tokens</span>')
  })

  it('uses update time only for Link-only sharing metadata', () => {
    const html = renderWorkbench({ visibility: 'link-only' })

    expect(html).toContain('>Link-only</span>')
    expect(html).toContain('Shared 3d ago')
    expect(html).not.toContain('Published 3d ago')
  })

  it('uses one Workspace section and omits the file browser', () => {
    const html = renderWorkbench()

    expect(html.match(/id="workspace-title"/g)).toHaveLength(1)
    expect(html).not.toContain(
      '<div class="border-t border-[var(--border)]"><h2 id="workspace-title"',
    )
    expect(html).not.toContain('>Metadata<')
    expect(html).not.toContain('>Files<')
    expect(html).not.toContain('apps/web/src/session.tsx')
  })

  it('keeps prompt markers uniform at rest and expands them on interaction', () => {
    const html = renderWorkbench()

    expect(html).toContain('w-4 bg-[var(--border-strong)]')
    expect(html).toContain('group-hover:w-6')
    expect(html).toContain('transition-[width,background-color]')
  })

  it('lets the page scroll the legacy MessageList fallback and compacts long titles', () => {
    const longFirstLine = `Review ${'the session workbench layout '.repeat(8)}`.trim()
    const html = renderWorkbench({
      spool: null,
      messages: {
        ...conversation,
        title: `${longFirstLine}\nThis line belongs in the full title only`,
      },
    })

    expect(html).toContain('class="min-w-0"><div data-testid="message-list"')
    expect(html).toContain('data-window-scroll="true"')
    expect(html).toContain('data-testid="message-list"')
    expect(html).toContain('…</h1>')
    expect(html).not.toContain('This line belongs in the full title only</h1>')
  })

  it('puts the Resume control below the title and links browser-addressable remotes', () => {
    const html = renderWorkbench({
      cardJson: JSON.stringify({
        remotes: ['origin: git@github.com:paperboytm/spool.git'],
        branch: 'main',
        head: 'abc123',
        dirty: [],
        observed: '2026-07-17T07:00:00.000Z',
      }),
    })

    const titleIndex = html.indexOf('id="sw-workbench-title"')
    const resumeIndex = html.indexOf('id="resume-session-title"')
    const timelineIndex = html.indexOf('id="session-timeline-title"')
    expect(titleIndex).toBeGreaterThan(-1)
    expect(resumeIndex).toBeGreaterThan(titleIndex)
    expect(timelineIndex).toBeGreaterThan(resumeIndex)
    // The commands live inside the popup now; the closed control shows one
    // labeled trigger and never forces the curl bootstrap inline.
    expect(html).toContain('Resume in Claude Code')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('curl -fsSL')
    expect(html).toContain('data-variant="accent"')
    expect(html).not.toContain('How npx works')
    expect(html).toContain('href="https://github.com/paperboytm/spool"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('origin: git@github.com:paperboytm/spool.git</a>')
    expect(html).toContain('class="sw-session-sticky min-w-0 lg:sticky"')
  })

  it('identifies a Pi share without offering an unsupported native Resume command', () => {
    const html = renderWorkbench({ provider: 'pi', visibility: 'link-only' })

    expect(html).toContain('data-variant="source-pi"')
    expect(html).toContain('>Pi</span>')
    expect(html).toContain('>Link-only</span>')
    expect(html).not.toContain('install.sh')
    expect(html).not.toContain('id="resume-session-title"')
    expect(html).not.toContain('Resume in ')
  })

  it('keeps the raw fallback usable without a summary, view, or messages', () => {
    const html = renderWorkbench({
      spool: null,
      summaryMd: '  ',
      view: null,
      messages: { title: '', messages: [], recordToMessageId: new Map() },
    })

    expect(html).toContain('Shared session</h1>')
    expect(html).toContain('No renderable messages in this session.')
    expect(html).not.toContain('Summary')
    expect(html).not.toContain('User prompts')
    expect(html).not.toContain('Files')
  })
})
