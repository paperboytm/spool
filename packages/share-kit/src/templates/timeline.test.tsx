import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { DEFAULT_OPTS, type Conversation, type EditorOpts } from '../lib/types'
import { Timeline, TimelineBody } from './timeline'

const conversation: Conversation = {
  source: 'claude-code',
  sourceLabel: 'Claude Code',
  origin: { kind: 'agent-session', agent: 'claude', sessionUuid: 'session-1' },
  title: 'Shared timeline',
  shareUrl: null,
  createdAt: '2026-07-16T09:00:00.000Z',
  wordCount: 12,
  readMin: 1,
  turns: [
    {
      role: 'user',
      body: 'First prompt',
      timestamp: '2026-07-16T09:00:00.000Z',
    },
    {
      role: 'assistant',
      body: '   ',
      timestamp: '2026-07-16T09:01:00.000Z',
    },
    {
      role: 'assistant',
      body: 'Visible answer',
      timestamp: '2026-07-16T09:02:00.000Z',
    },
    {
      role: 'user',
      body: 'Follow-up prompt',
      timestamp: '2026-07-17T10:00:00.000Z',
    },
  ],
}

const opts: EditorOpts = {
  ...DEFAULT_OPTS,
  template: 'timeline',
  typeface: 'geist',
  redact: false,
}

function turnAnchors(html: string): string[] {
  return Array.from(html.matchAll(/data-turn-index="(\d+)"/g), (match) => match[1]!)
}

describe('TimelineBody', () => {
  it('is the same anchored turn body used by the complete Timeline document', () => {
    const documentHtml = renderToStaticMarkup(<Timeline convo={conversation} opts={opts} />)
    const bodyHtml = renderToStaticMarkup(<TimelineBody convo={conversation} opts={opts} />)

    expect(turnAnchors(documentHtml)).toEqual(['0', '2', '3'])
    expect(turnAnchors(bodyHtml)).toEqual(turnAnchors(documentHtml))
    expect(documentHtml.match(/data-turn-body/g)).toHaveLength(3)
    expect(bodyHtml.match(/data-turn-body/g)).toHaveLength(3)
    expect(documentHtml).toContain(bodyHtml)

    expect(documentHtml).toContain('Shared timeline')
    expect(documentHtml).toContain('§ Timeline')
    expect(documentHtml).toContain('Stitched on Spool')
    expect(bodyHtml).not.toContain('Shared timeline')
    expect(bodyHtml).not.toContain('§ Timeline')
    expect(bodyHtml).not.toContain('Stitched on Spool')
  })

  it('keeps selection, skipped-gap, and empty-turn behavior aligned', () => {
    const selectedOpts: EditorOpts = {
      ...opts,
      selected: [0, 1, 3],
      showGaps: true,
      hideEmptyTurns: true,
    }
    const documentHtml = renderToStaticMarkup(<Timeline convo={conversation} opts={selectedOpts} />)
    const bodyHtml = renderToStaticMarkup(<TimelineBody convo={conversation} opts={selectedOpts} />)

    expect(turnAnchors(documentHtml)).toEqual(['0', '3'])
    expect(turnAnchors(bodyHtml)).toEqual(turnAnchors(documentHtml))
    expect(documentHtml).toContain('2 turns skipped')
    expect(bodyHtml).toContain('2 turns skipped')

    const showEmptyOpts = { ...selectedOpts, hideEmptyTurns: false }
    const showEmptyDocumentHtml = renderToStaticMarkup(
      <Timeline convo={conversation} opts={showEmptyOpts} />,
    )
    const showEmptyBodyHtml = renderToStaticMarkup(
      <TimelineBody convo={conversation} opts={showEmptyOpts} />,
    )

    expect(turnAnchors(showEmptyDocumentHtml)).toEqual(['0', '1', '3'])
    expect(turnAnchors(showEmptyBodyHtml)).toEqual(turnAnchors(showEmptyDocumentHtml))
  })

  it('carries its paper, typeface, accent, and Body variables when embedded alone', () => {
    const styledOpts: EditorOpts = {
      ...opts,
      paper: 'ink',
      typeface: 'fraunces',
      accentHex: '#D67259',
    }
    const html = renderToStaticMarkup(<TimelineBody convo={conversation} opts={styledOpts} />)

    expect(html).toContain('data-spool-timeline-body="true"')
    expect(html).toContain('--sk-accent:#D67259')
    expect(html).toContain('--sk-accent-bg:#D6725926')
    expect(html).toContain('--sk-body-font:&#x27;Fraunces Variable&#x27;')
    expect(html).toContain('--sk-block-border:rgba(242,242,236,0.10)')
    expect(html).toContain('font-family:&#x27;Fraunces Variable&#x27;')
    expect(html).toContain('background:#1A1A16')
    expect(html).toContain('color:#F2F2EC')
  })

  it('uses an injected redact list in the standalone body', () => {
    const sensitive = 'private-fixture-value'
    const redactedConversation: Conversation = {
      ...conversation,
      turns: [{ role: 'user', body: `Token: ${sensitive}` }],
    }
    const html = renderToStaticMarkup(
      <TimelineBody
        convo={redactedConversation}
        opts={{ ...opts, redact: true }}
        redactList={[{ value: sensitive, replacement: '[redacted fixture]' }]}
      />,
    )

    expect(html).not.toContain(sensitive)
    expect(html).toContain('[redacted fixture]')
  })

  it('only progressively limits the standalone body when explicitly enabled', () => {
    const turns = Array.from({ length: 100 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      body: `Turn ${index}`,
    }))
    const longConversation = { ...conversation, turns }
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame

    try {
      const completeHtml = renderToStaticMarkup(
        <TimelineBody convo={longConversation} opts={opts} />,
      )
      const progressiveHtml = renderToStaticMarkup(
        <TimelineBody convo={longConversation} opts={opts} progressive />,
      )

      expect(turnAnchors(completeHtml)).toHaveLength(100)
      expect(turnAnchors(progressiveHtml)).toHaveLength(80)
      expect(turnAnchors(progressiveHtml).at(-1)).toBe('79')
    } finally {
      if (originalRequestAnimationFrame === undefined) {
        Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
      } else {
        globalThis.requestAnimationFrame = originalRequestAnimationFrame
      }
    }
  })
})
