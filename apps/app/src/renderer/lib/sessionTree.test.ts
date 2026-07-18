import type { Session } from '@spool-lab/core'
import { describe, expect, it } from 'vite-plus/test'

import { buildSessionForest } from './sessionTree.js'

function session(
  sessionUuid: string,
  parentSessionUuid: string | null,
  startedAt: string,
): Session {
  return {
    id: 1,
    projectId: 1,
    sourceId: 2,
    sessionUuid,
    parentSessionUuid,
    filePath: `/tmp/${sessionUuid}.jsonl`,
    title: sessionUuid,
    startedAt,
    endedAt: startedAt,
    messageCount: 1,
    hasToolUse: false,
    cwd: '/tmp',
    model: null,
    source: 'codex',
    projectDisplayPath: '/tmp',
    projectDisplayName: 'tmp',
    scanFindingCount: 0,
    scanHighCount: 0,
    scanPurgedCount: 0,
    scanCompletedAt: null,
  }
}

describe('buildSessionForest', () => {
  it('builds nested sessions and sorts siblings chronologically', () => {
    const forest = buildSessionForest([
      session('root', null, '2026-01-01T00:00:00Z'),
      session('later', 'root', '2026-01-01T00:02:00Z'),
      session('earlier', 'root', '2026-01-01T00:01:00Z'),
      session('grandchild', 'earlier', '2026-01-01T00:03:00Z'),
    ])

    expect(forest.map((node) => node.session.sessionUuid)).toEqual(['root'])
    expect(forest[0]?.children.map((node) => node.session.sessionUuid)).toEqual([
      'earlier',
      'later',
    ])
    expect(forest[0]?.children[0]?.children[0]?.session.sessionUuid).toBe('grandchild')
  })

  it('promotes orphaned and cyclic sessions to roots', () => {
    const forest = buildSessionForest([
      session('orphan', 'missing', '2026-01-01T00:00:00Z'),
      session('a', 'b', '2026-01-01T00:01:00Z'),
      session('b', 'a', '2026-01-01T00:02:00Z'),
    ])

    expect(forest.map((node) => node.session.sessionUuid)).toEqual(['orphan', 'a', 'b'])
  })
})
