// PROTOTYPE — throwaway (see NOTES.md in this directory).
//
// Dev-only mock data for the /session/<sid> UI variants: a small but
// realistic Claude session so the page renders without a local
// the backend. Activated by `?mock=1`; the caller additionally gates
// on import.meta.env.DEV so this can never serve in production.

import { deriveView, type SessionViewV1 } from '@spool-lab/session-kit'

import type { HubRecordLine, HubSessionMeta } from '../../../lib/hub-api'

export interface SessionFixture {
  meta: HubSessionMeta
  view: SessionViewV1
  records: HubRecordLine[]
}

const FEED_PATH = 'apps/app/src/renderer/components/record-feed.tsx'
const TEST_PATH = 'apps/app/src/renderer/components/record-feed.scroll.test.tsx'

const FEED_BEFORE = [
  "import { useEffect, useRef } from 'react'",
  '',
  "import { RecordRow, type FeedRecord } from './record-row'",
  '',
  'export function RecordFeed({ records }: { records: FeedRecord[] }) {',
  '  const scroller = useRef<HTMLDivElement>(null)',
  '',
  '  useEffect(() => {',
  '    // Follow the stream as new records arrive.',
  '    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })',
  '  }, [records.length])',
  '',
  '  return (',
  '    <div ref={scroller} className="record-feed">',
  '      {records.map((record) => <RecordRow key={record.i} record={record} />)}',
  '    </div>',
  '  )',
  '}',
].join('\n')

const FEED_OLD = [
  '  useEffect(() => {',
  '    // Follow the stream as new records arrive.',
  '    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })',
  '  }, [records.length])',
].join('\n')

const FEED_NEW = [
  '  const stick = useRef(true)',
  '',
  '  useEffect(() => {',
  '    const el = scroller.current',
  '    if (!el) return',
  '    const onScroll = () => {',
  '      stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24',
  '    }',
  "    el.addEventListener('scroll', onScroll, { passive: true })",
  "    return () => el.removeEventListener('scroll', onScroll)",
  '  }, [])',
  '',
  '  useEffect(() => {',
  '    // Follow the stream only while the reader is already at the bottom.',
  '    if (!stick.current) return',
  '    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })',
  '  }, [records.length])',
].join('\n')

const TEST_CONTENT = [
  '// Regression: the feed must not yank the viewport back to the bottom',
  '// while the reader is scrolled up in older records (spool#412).',
  "import { render } from '@testing-library/react'",
  "import { describe, expect, it, vi } from 'vitest'",
  '',
  "import { RecordFeed } from './record-feed'",
  '',
  "describe('RecordFeed follow-scroll', () => {",
  "  it('keeps the viewport still when scrolled away from the bottom', () => {",
  '    const { container, rerender } = render(<RecordFeed records={few} />)',
  "    scrollAwayFromBottom(container.firstElementChild as HTMLElement)",
  '    rerender(<RecordFeed records={more} />)',
  '    expect(scrollTopOf(container)).toBe(scrollTopBeforeRerender)',
  '  })',
  '})',
].join('\n')

const PROMPT_1 =
  'The session detail pane jumps back to the bottom every time new records ' +
  'stream in — if I scroll up to read something older it yanks me away ' +
  'mid-sentence. Can you make the follow-scroll only apply when I am ' +
  'already at the bottom?'

const DIAGNOSIS =
  'Found it. `RecordFeed` has an effect keyed on `records.length` that calls ' +
  '`scrollTo(bottom)` unconditionally — every streamed record scrolls the pane, ' +
  'regardless of where you are.\n\nThe usual fix is a "stick to bottom" flag: ' +
  'track whether the viewport is at (or near) the bottom on every scroll, and ' +
  'only follow the stream while that flag is true. Scrolling up detaches you; ' +
  'scrolling back down re-attaches.'

const FIX_SUMMARY =
  'Done. The feed now tracks a `stick` ref updated on scroll (within 24px of ' +
  'the bottom counts as "at the bottom"), and the follow-scroll effect bails ' +
  'when you have scrolled up. Streaming keeps following you only when you ' +
  'were already following it.'

const PROMPT_2 = 'Nice, that feels right. Add a regression test so this stays fixed.'

const CLOSING =
  'Added `record-feed.scroll.test.tsx`: it renders the feed, scrolls away from ' +
  'the bottom, streams more records in, and asserts the viewport did not move. ' +
  'Suite is green — 14 passed, 0 failed.\n\nRecap of the change:\n' +
  '- `record-feed.tsx`: follow-scroll now guarded by a stick-to-bottom check\n' +
  '- `record-feed.scroll.test.tsx`: regression coverage for reading-while-streaming'

// Fixed timestamps — a believable half-hour session on a fixed date, so
// snapshots are stable and nothing in the fixture depends on "now".
const T = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 6, 14, 9, minute, second)).toISOString()
const EPOCH = Date.UTC(2026, 6, 14, 9, 41)

const SESSION_UUID = '5f2c1e6a-9d38-4b7a-8c21-0d5e7f3a1b90'
const CWD = '/Users/xinyao/work/spool'

interface RawRecord {
  [key: string]: unknown
}

function jsonl(objects: RawRecord[]): HubRecordLine[] {
  return objects.map((object, i) => ({
    i,
    oid: `mock-oid-${String(i).padStart(3, '0')}`,
    data: JSON.stringify(object),
  }))
}

function makeRecords(): HubRecordLine[] {
  return jsonl([
    {
      type: 'user',
      uuid: 'u-000',
      parentUuid: null,
      sessionId: SESSION_UUID,
      cwd: CWD,
      timestamp: T(2),
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: PROMPT_1 }] },
    },
    {
      type: 'assistant',
      uuid: 'a-001',
      parentUuid: 'u-000',
      timestamp: T(4),
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: DIAGNOSIS }],
      },
    },
    {
      type: 'assistant',
      uuid: 'a-002',
      parentUuid: 'a-001',
      timestamp: T(6),
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'text', text: 'Guarding the follow-scroll behind a stick-to-bottom check:' },
          {
            type: 'tool_use',
            id: 'toolu-mock-001',
            name: 'Edit',
            input: { file_path: FEED_PATH, old_string: FEED_OLD, new_string: FEED_NEW },
          },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u-003',
      parentUuid: 'a-002',
      timestamp: T(6, 20),
      isSidechain: false,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-mock-001', content: 'ok' }],
      },
      toolUseResult: { originalFile: FEED_BEFORE },
    },
    {
      type: 'assistant',
      uuid: 'a-004',
      parentUuid: 'u-003',
      timestamp: T(8),
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: FIX_SUMMARY }],
      },
    },
    {
      type: 'user',
      uuid: 'u-005',
      parentUuid: 'a-004',
      timestamp: T(24),
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: PROMPT_2 }] },
    },
    {
      type: 'assistant',
      uuid: 'a-006',
      parentUuid: 'u-005',
      timestamp: T(26),
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'text', text: 'Writing the regression test:' },
          {
            type: 'tool_use',
            id: 'toolu-mock-002',
            name: 'Write',
            input: { file_path: TEST_PATH, content: TEST_CONTENT },
          },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u-007',
      parentUuid: 'a-006',
      timestamp: T(26, 15),
      isSidechain: false,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-mock-002', content: 'ok' }],
      },
      toolUseResult: { originalFile: null },
    },
    {
      type: 'assistant',
      uuid: 'a-008',
      parentUuid: 'u-007',
      timestamp: T(38),
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: CLOSING }],
      },
    },
  ])
}

const NOTE_MD =
  'Chased the session-detail auto-scroll bug: the record feed yanked the ' +
  'viewport back to the bottom on every streamed record. Root cause and fix ' +
  'are both in here — the follow-scroll now only applies while you are ' +
  'already at the bottom, with a regression test. The diagnosis at the top ' +
  'is the part worth reading.'

const CARD_JSON = JSON.stringify({
  remotes: ['github.com/spool-lab/spool'],
  branch: 'fix/detail-autoscroll',
  head: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
  dirty: [],
  observed: T(40),
})

export function makeSessionFixture(sid: string): SessionFixture {
  const records = makeRecords()
  const view = deriveView('claude', records.map((record) => ({ i: record.i, data: record.data })))
  const meta: HubSessionMeta = {
    sid,
    root: 'mock-root-oid',
    count: records.length,
    sig: null,
    noteMd: NOTE_MD,
    cardJson: CARD_JSON,
    lineageJson: null,
    viewOid: 'mock-view-oid',
    createdAt: EPOCH - 39 * 60_000,
    updatedAt: EPOCH,
    author: { handle: 'xinyao', displayName: 'Xinyao', avatarUrl: null },
  }
  return { meta, view, records }
}
