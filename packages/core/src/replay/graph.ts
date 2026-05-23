import type { Message } from '../types.js'
import { buildReplayEvents, type ReplayEvent } from './events.js'

export type ReplayGraphEdgeKind = 'parent' | 'sequence' | 'tool'

export interface ReplayGraphNode {
  id: string
  eventId: string
  kind: ReplayEvent['kind']
  label: string
  timestamp: string
  seq: number
  isSidechain: boolean
  event: ReplayEvent
}

export interface ReplayGraphEdge {
  id: string
  kind: ReplayGraphEdgeKind
  source: string
  target: string
}

export interface ReplayGraph {
  nodes: ReplayGraphNode[]
  edges: ReplayGraphEdge[]
}

export function buildReplayGraph(messages: Message[]): ReplayGraph {
  return buildReplayGraphFromEvents(buildReplayEvents(messages))
}

export function buildReplayGraphFromEvents(events: ReplayEvent[]): ReplayGraph {
  const ordered = [...events].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
  const nodes = ordered.map(eventToNode)
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges: ReplayGraphEdge[] = []
  const edgeKeys = new Set<string>()

  for (const event of ordered) {
    if (!event.parentEventId || !nodeIds.has(event.parentEventId) || event.parentEventId === event.id) {
      continue
    }
    pushEdge(edges, edgeKeys, {
      id: `${event.kind === 'tool_call' ? 'tool' : 'parent'}:${event.parentEventId}->${event.id}`,
      kind: event.kind === 'tool_call' ? 'tool' : 'parent',
      source: event.parentEventId,
      target: event.id,
    })
  }

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const next = ordered[i]
    if (!prev || !next) continue
    pushEdge(edges, edgeKeys, {
      id: `sequence:${prev.id}->${next.id}`,
      kind: 'sequence',
      source: prev.id,
      target: next.id,
    })
  }

  return { nodes, edges }
}

export function renderReplayGraphMermaid(graph: ReplayGraph): string {
  const nodeIds = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]))
  const lines = ['flowchart TD']

  for (const node of graph.nodes) {
    const id = nodeIds.get(node.id)
    if (!id) continue
    lines.push(`  ${id}["${escapeMermaidLabel(node.label)}"]`)
  }

  for (const edge of graph.edges) {
    const source = nodeIds.get(edge.source)
    const target = nodeIds.get(edge.target)
    if (!source || !target) continue
    if (edge.kind === 'sequence') {
      lines.push(`  ${source} -.-> ${target}`)
    } else if (edge.kind === 'tool') {
      lines.push(`  ${source} -- tool --> ${target}`)
    } else {
      lines.push(`  ${source} --> ${target}`)
    }
  }

  return lines.join('\n')
}

function eventToNode(event: ReplayEvent): ReplayGraphNode {
  return {
    id: event.id,
    eventId: event.id,
    kind: event.kind,
    label: eventLabel(event),
    timestamp: event.timestamp,
    seq: event.seq,
    isSidechain: event.isSidechain,
    event,
  }
}

function eventLabel(event: ReplayEvent): string {
  if (event.kind === 'tool_call') return event.toolName

  const text = event.contentText
    .replace(/\s+/g, ' ')
    .trim()
  if (text) return truncate(text, 80)
  if (event.kind === 'user_prompt') return 'User prompt'
  if (event.kind === 'assistant_response') return 'Assistant response'
  return 'System note'
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function escapeMermaidLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
}

function pushEdge(edges: ReplayGraphEdge[], seen: Set<string>, edge: ReplayGraphEdge): void {
  const key = `${edge.kind}:${edge.source}->${edge.target}`
  if (seen.has(key)) return
  seen.add(key)
  edges.push(edge)
}
