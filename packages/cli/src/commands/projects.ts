import { Command } from 'commander'
import { getDB, listProjectGroups, listSessionsByIdentity } from '@spool-lab/core'
import type { ProjectGroup, ProjectGroupWithPaths } from '@spool-lab/core'
import { formatDate, printSession } from '../format.js'

export type ProjectResolution =
  | { kind: 'match'; group: ProjectGroupWithPaths }
  | { kind: 'ambiguous'; groups: ProjectGroupWithPaths[] }
  | { kind: 'none' }

/**
 * Resolve a free-text query to a single project group. An exact (case-
 * insensitive) hit on the display name, identity key, project path, or any
 * session cwd wins outright, so `projects spool` picks "spool" over the
 * "spool-daemon" substring and a pasted identity key always lands uniquely.
 * Exact basename hits on identity keys or project paths win over substring
 * matches, so a repo slug can disambiguate similarly named projects.
 * Otherwise fall back to substring matching by field priority, reporting
 * ambiguity when more than one group matches at the winning priority.
 */
export function resolveProjectQuery(groups: ProjectGroupWithPaths[], query: string): ProjectResolution {
  const q = query.toLowerCase()

  const exact = groups.filter(g => allSearchableProjectFields(g).some(v => v === q))
  if (exact.length > 0) return pick(exact)

  const exactBasename = groups.filter(g => basenameSearchableProjectFields(g).some(v => v === q))
  if (exactBasename.length > 0) return pick(exactBasename)

  for (const tier of partialSearchableProjectFieldTiers) {
    const matches = groups.filter(g => tier(g).some(v => v.includes(q)))
    if (matches.length > 0) return pick(matches)
  }

  return { kind: 'none' }
}

function allSearchableProjectFields(group: ProjectGroupWithPaths): string[] {
  return [
    group.displayName,
    group.identityKey,
    ...group.displayPaths,
    ...group.cwds,
  ].map(v => v.toLowerCase())
}

function basenameSearchableProjectFields(group: ProjectGroupWithPaths): string[] {
  return [
    group.identityKey,
    ...group.displayPaths,
  ].map(v => basename(v).toLowerCase()).filter(Boolean)
}

function basename(value: string): string {
  const normalized = value.replace(/\.git$/i, '').replace(/\/+$/g, '')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

const partialSearchableProjectFieldTiers: Array<(group: ProjectGroupWithPaths) => string[]> = [
  group => [group.displayName, group.identityKey].map(v => v.toLowerCase()),
  group => group.displayPaths.map(v => v.toLowerCase()),
  group => group.cwds.map(v => v.toLowerCase()),
]

function pick(matches: ProjectGroupWithPaths[]): ProjectResolution {
  const [first, ...rest] = matches
  if (first && rest.length === 0) return { kind: 'match', group: first }
  return { kind: 'ambiguous', groups: matches }
}

export const projectsCommand = new Command('projects')
  .description('List your projects, or the sessions in one')
  .argument('[query]', 'Show sessions in the project matching this name, identity key, project path, or cwd')
  .option('-n, --limit <n>', 'Max sessions to show (with a query)', '20')
  .option('--json', 'Output as JSON')
  .action((query: string | undefined, opts: { limit: string; json?: boolean }) => {
    const db = getDB(true)

    if (!query) {
      listGroups(listProjectGroups(db), opts.json === true)
      return
    }

    const resolved = resolveProjectQuery(listProjectGroups(db, { withPaths: true }), query)
    if (resolved.kind === 'none') {
      console.error(`No project matching: ${query}`)
      process.exit(1)
    }
    if (resolved.kind === 'ambiguous') {
      console.error(`Multiple projects match "${query}":`)
      for (const g of resolved.groups) {
        console.error(`  ${g.displayName}  (${g.identityKey})`)
      }
      console.error('Refine the query, or pass a full identity key, project path, or cwd.')
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
