import type { Session } from '@spool-lab/core'

export type SessionTreeNode = {
  session: Session
  children: SessionTreeNode[]
}

export function buildSessionForest(sessions: Session[]): SessionTreeNode[] {
  const nodes = new Map<string, SessionTreeNode>(
    sessions.map((session) => [session.sessionUuid, { session, children: [] }]),
  )
  const roots: SessionTreeNode[] = []

  for (const session of sessions) {
    const node = nodes.get(session.sessionUuid)!
    const parentUuid = session.parentSessionUuid
    const parent = parentUuid ? nodes.get(parentUuid) : undefined
    if (!parent || createsCycle(session.sessionUuid, parentUuid!, nodes)) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

  const sortChildren = (node: SessionTreeNode): void => {
    node.children.sort(compareChronologically)
    for (const child of node.children) sortChildren(child)
  }
  for (const root of roots) sortChildren(root)

  return roots
}

function createsCycle(
  childUuid: string,
  parentUuid: string,
  nodes: Map<string, SessionTreeNode>,
): boolean {
  const seen = new Set([childUuid])
  let current: string | null = parentUuid
  while (current) {
    if (seen.has(current)) return true
    seen.add(current)
    current = nodes.get(current)?.session.parentSessionUuid ?? null
  }
  return false
}

function compareChronologically(a: SessionTreeNode, b: SessionTreeNode): number {
  const byTime = a.session.startedAt.localeCompare(b.session.startedAt)
  return byTime || a.session.sessionUuid.localeCompare(b.session.sessionUuid)
}
