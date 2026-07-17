import type { Session, ProjectSessionSortOrder } from '@spool-lab/core'

/**
 * Mirror of the SQL `ORDER BY` clauses in `listSessionsByIdentity` /
 * `listRecentSessionsPage`. Returns negative when `a` should sort before
 * `b`. Used for client-side reinsertion when a session moves between
 * pinned and recent without going through a full refetch.
 */
export function compareSessions(a: Session, b: Session, order: ProjectSessionSortOrder): number {
  switch (order) {
    case 'oldest':
      if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1
      return a.sessionUuid < b.sessionUuid ? -1 : 1
    case 'most_messages':
      if (a.messageCount !== b.messageCount) return a.messageCount > b.messageCount ? -1 : 1
      if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt ? -1 : 1
      return a.sessionUuid < b.sessionUuid ? -1 : 1
    case 'title': {
      const ta = a.title ?? ''
      const tb = b.title ?? ''
      if (ta !== tb) return ta < tb ? -1 : 1
      if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt ? -1 : 1
      return a.sessionUuid < b.sessionUuid ? -1 : 1
    }
    case 'recent':
    default:
      if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt ? -1 : 1
      return a.sessionUuid < b.sessionUuid ? -1 : 1
  }
}

/**
 * Re-insert a session into the already-loaded page list at its sorted
 * position. If the candidate would sort beyond the last loaded row and
 * we haven't paginated to the end (`exhausted=false`), drop it — the
 * session lives in a not-yet-loaded page and will appear when scrolled.
 */
export function insertSessionSorted(
  sessions: Session[],
  candidate: Session,
  order: ProjectSessionSortOrder,
  exhausted: boolean,
): Session[] {
  const last = sessions[sessions.length - 1]
  if (last && compareSessions(candidate, last, order) > 0 && !exhausted) {
    return sessions
  }
  const idx = sessions.findIndex(s => compareSessions(candidate, s, order) <= 0)
  if (idx === -1) return [...sessions, candidate]
  return [...sessions.slice(0, idx), candidate, ...sessions.slice(idx)]
}
