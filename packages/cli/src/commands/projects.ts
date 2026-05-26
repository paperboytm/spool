import { Command } from 'commander'
import { getDB, listProjectGroups, listSessionsByIdentity } from '@spool-lab/core'
import type { ProjectGroup } from '@spool-lab/core'
import { formatDate, printSession } from '../format.js'

export type ProjectResolution =
  | { kind: 'match'; group: ProjectGroup }
  | { kind: 'ambiguous'; groups: ProjectGroup[] }
  | { kind: 'none' }

/**
 * Resolve a free-text query to a single project group. An exact (case-
 * insensitive) hit on the display name or identity key wins outright, so
 * `projects spool` picks "spool" over the "spool-daemon" substring and a
 * pasted identity key always lands uniquely. Otherwise fall back to
 * substring matching, reporting ambiguity when more than one group matches.
 */
export function resolveProjectQuery(groups: ProjectGroup[], query: string): ProjectResolution {
  const q = query.toLowerCase()

  const exact = groups.filter(
    g => g.displayName.toLowerCase() === q || g.identityKey.toLowerCase() === q,
  )
  if (exact.length > 0) return pick(exact)

  const partial = groups.filter(
    g => g.displayName.toLowerCase().includes(q) || g.identityKey.toLowerCase().includes(q),
  )
  if (partial.length === 0) return { kind: 'none' }
  return pick(partial)
}

function pick(matches: ProjectGroup[]): ProjectResolution {
  const [first, ...rest] = matches
  if (first && rest.length === 0) return { kind: 'match', group: first }
  return { kind: 'ambiguous', groups: matches }
}

export const projectsCommand = new Command('projects')
  .description('List your projects, or the sessions in one')
  .argument('[query]', 'Show sessions in the project matching this name or identity key')
  .option('-n, --limit <n>', 'Max sessions to show (with a query)', '20')
  .option('--json', 'Output as JSON')
  .action((query: string | undefined, opts: { limit: string; json?: boolean }) => {
    const db = getDB(true)
    const groups = listProjectGroups(db)

    if (!query) {
      listGroups(groups, opts.json === true)
      return
    }

    const resolved = resolveProjectQuery(groups, query)
    if (resolved.kind === 'none') {
      console.error(`No project matching: ${query}`)
      process.exit(1)
    }
    if (resolved.kind === 'ambiguous') {
      console.error(`Multiple projects match "${query}":`)
      for (const g of resolved.groups) {
        console.error(`  ${g.displayName}  (${g.identityKey})`)
      }
      console.error('Refine the query, or pass a full identity key.')
      process.exit(1)
    }

    const group = resolved.group
    const sessions = listSessionsByIdentity(db, group.identityKey, {
      limit: parseInt(opts.limit, 10),
    }).sessions

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2))
      return
    }
    if (sessions.length === 0) {
      console.log(`No sessions in ${group.displayName}.`)
      return
    }
    console.log(`${group.displayName}  ·  ${group.identityKey}`)
    for (const s of sessions) {
      printSession(s)
    }
  })

function listGroups(groups: ProjectGroup[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(groups, null, 2))
    return
  }
  if (groups.length === 0) {
    console.log('No projects found. Run `spool sync` to index sessions.')
    return
  }
  for (const g of groups) {
    const count = String(g.sessionCount).padStart(4)
    const date = (g.lastSessionAt ? formatDate(g.lastSessionAt) : '—').padEnd(10)
    const sources = g.sources.join(',').padEnd(14)
    const name = g.displayName.slice(0, 50)
    console.log(`${count}  ${date}  ${sources}  ${name}`)
  }
}
