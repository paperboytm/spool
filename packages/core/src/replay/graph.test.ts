import { describe, expect, it } from 'vitest'
import type { Message } from '../types.js'
import { buildReplayGraph, buildReplayGraphFromEvents, renderReplayGraphMermaid } from './graph.js'

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    sessionId: 10,
    msgUuid: null,
    parentUuid: null,
    role: 'user',
    contentText: '',
    timestamp: '2026-01-01T00:00:00.000Z',
    isSidechain: false,
    toolNames: [],
    seq: 0,
    ...overrides,
  }
}

describe('buildReplayGraph', () => {
  it('builds nodes from replay events and sequence edges in replay order', () => {
    const graph = buildReplayGraph([
      message({ id: 2, msgUuid: 'a1', role: 'assistant', contentText: 'Done', seq: 1 }),
      message({ id: 1, msgUuid: 'u1', role: 'user', contentText: 'Start', seq: 0 }),
    ])

    expect(graph.nodes.map(node => node.id)).toEqual(['message:u1', 'message:a1'])
    expect(graph.edges).toContainEqual({
      id: 'sequence:message:u1->message:a1',
      kind: 'sequence',
      source: 'message:u1',
      target: 'message:a1',
    })
  })

  it('adds parent edges from Claude parent UUIDs', () => {
    const graph = buildReplayGraph([
      message({ id: 1, msgUuid: 'u1', role: 'user', contentText: 'Start', seq: 0 }),
      message({ id: 2, msgUuid: 'a1', parentUuid: 'u1', role: 'assistant', contentText: 'Done', seq: 1 }),
    ])

    expect(graph.edges).toContainEqual({
      id: 'parent:message:u1->message:a1',
      kind: 'parent',
      source: 'message:u1',
      target: 'message:a1',
    })
  })

  it('adds tool edges from assistant message containers to tool call nodes', () => {
    const graph = buildReplayGraph([
      message({
        id: 1,
        msgUuid: 'a-tool',
        role: 'assistant',
        contentText: 'Inspecting files',
        toolNames: ['Read'],
        seq: 0,
      }),
    ])

    expect(graph.nodes.map(node => [node.id, node.kind, node.label])).toEqual([
      ['message:a-tool', 'assistant_response', 'Inspecting files'],
      ['message:a-tool:tool:0', 'tool_call', 'Read'],
    ])
    expect(graph.edges).toContainEqual({
      id: 'tool:message:a-tool->message:a-tool:tool:0',
      kind: 'tool',
      source: 'message:a-tool',
      target: 'message:a-tool:tool:0',
    })
  })

  it('keeps tool-only messages graphable with a message container node', () => {
    const graph = buildReplayGraph([
      message({ id: 1, msgUuid: 'tool-only', role: 'assistant', contentText: '', toolNames: ['Bash'], seq: 0 }),
    ])

    expect(graph.nodes.map(node => [node.id, node.kind, node.label])).toEqual([
      ['message:tool-only', 'assistant_response', 'Assistant response'],
      ['message:tool-only:tool:0', 'tool_call', 'Bash'],
    ])
    expect(graph.edges).toContainEqual({
      id: 'tool:message:tool-only->message:tool-only:tool:0',
      kind: 'tool',
      source: 'message:tool-only',
      target: 'message:tool-only:tool:0',
    })
  })

  it('drops parent edges when the parent event is absent', () => {
    const graph = buildReplayGraphFromEvents([
      {
        id: 'message:a1',
        kind: 'assistant_response',
        role: 'assistant',
        contentText: 'Orphan reply',
        toolNames: [],
        timestamp: '2026-01-01T00:00:00.000Z',
        seq: 0,
        msgUuid: 'a1',
        parentMsgUuid: 'missing',
        parentEventId: 'message:missing',
        isSidechain: false,
      },
    ])

    expect(graph.nodes).toHaveLength(1)
    expect(graph.edges).toEqual([])
  })

  it('renders a deterministic Mermaid graph', () => {
    const graph = buildReplayGraph([
      message({ id: 1, msgUuid: 'u1', role: 'user', contentText: 'Read "notes" [today]', seq: 0 }),
      message({ id: 2, msgUuid: 'a1', parentUuid: 'u1', role: 'assistant', contentText: 'Using search', toolNames: ['Grep'], seq: 1 }),
    ])

    expect(renderReplayGraphMermaid(graph)).toBe([
      'flowchart TD',
      '  n0["Read \\"notes\\" &#91;today&#93;"]',
      '  n1["Using search"]',
      '  n2["Grep"]',
      '  n0 --> n1',
      '  n1 -- tool --> n2',
      '  n0 -.-> n1',
      '  n1 -.-> n2',
    ].join('\n'))
  })
})
