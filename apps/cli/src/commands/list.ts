import {
  getDB,
  listRecentSessionsPage,
  listSessionsByIdentity,
  resolveLocalProjectIdentity,
  type Session,
  type SessionSource,
  type SessionsCursor,
} from '@spool-lab/core'
import { Command } from 'commander'

import { formatDate, printSession } from '../format.js'
import { createClackUi, createTextUi, type CliSelectOption, type CliUi } from '../ui.js'

const SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode', 'pi'])

export interface ListCommandOptions {
  limit: string
  source?: string
  project?: string
  all?: boolean
  json?: boolean
}

export interface ListCommandDependencies {
  db?: ReturnType<typeof getDB>
  ui?: CliUi
  cwd?: string
  limitExplicit?: boolean
}

export async function handleListCommand(
  opts: ListCommandOptions,
  dependencies: ListCommandDependencies = {},
): Promise<string | null> {
  const db = dependencies.db ?? getDB(true)
  const ui = dependencies.ui ?? createTextUi()
  const limit = parseInt(opts.limit, 10)
  const maxResults = ui.interactive && !opts.json && !dependencies.limitExplicit ? Infinity : limit
  const loadPage = createSessionPageLoader({
    db,
    opts,
    cwd: dependencies.cwd ?? process.cwd(),
    pageSize: limit,
    maxResults,
  })
  const firstPage = loadPage()
  const sessions = firstPage.sessions

  if (opts.json) {
    console.log(JSON.stringify(sessions, null, 2))
    return null
  }

  if (sessions.length === 0) {
    if (!opts.all && listRecentSessionsPage(db, { limit: 1 }).sessions.length > 0) {
      console.log(
        'No sessions found for the current project. Run `spool list --all` to search all projects.',
      )
      return null
    }
    console.log('No sessions found. Run `spool sync` to index sessions.')
    return null
  }

  if (ui.interactive) {
    return ui.autocomplete({
      message: 'Select a Session',
      choices: sessions.map(toAutocompleteChoice),
      ...(firstPage.hasMore
        ? {
            loadMore: () => {
              const page = loadPage()
              return {
                choices: page.sessions.map(toAutocompleteChoice),
                hasMore: page.hasMore,
              }
            },
          }
        : {}),
      placeholder: 'Search Sessions…',
      maxItems: 10,
    })
  }

  for (const session of sessions) {
    printSession(session)
  }
  return null
}

function toAutocompleteChoice(session: Session): CliSelectOption<string> {
  const shortId = session.sessionUuid.slice(0, 8)
  return {
    value: session.sessionUuid,
    label: `${shortId}  ${session.title ?? '(no title)'}`,
    hint: `${session.source} · ${formatDate(session.startedAt)} · ${session.projectDisplayName}`,
  }
}

interface SessionPageLoaderOptions {
  db: ReturnType<typeof getDB>
  opts: ListCommandOptions
  cwd: string
  pageSize: number
  maxResults: number
}

function createSessionPageLoader({
  db,
  opts,
  cwd,
  pageSize,
  maxResults,
}: SessionPageLoaderOptions): () => { sessions: Session[]; hasMore: boolean } {
  const identityKey = opts.all ? undefined : resolveLocalProjectIdentity(db, cwd).key
  const source =
    opts.source && SESSION_SOURCES.has(opts.source) ? (opts.source as SessionSource) : undefined
  const projectNeedle = opts.project?.toLowerCase()
  let cursor: SessionsCursor | undefined
  let exhausted = false
  let emitted = 0

  return () => {
    const target = Math.min(pageSize, maxResults - emitted)
    const sessions: Session[] = []

    while (sessions.length < target && !exhausted) {
      const queryLimit = target - sessions.length
      const page = opts.all
        ? listRecentSessionsPage(db, {
            limit: queryLimit,
            ...(cursor === undefined ? {} : { cursor }),
          })
        : listSessionsByIdentity(db, identityKey!, {
            limit: queryLimit,
            ...(source === undefined ? {} : { sources: [source] }),
            ...(cursor === undefined ? {} : { cursor }),
          })

      cursor = page.nextCursor ?? undefined
      exhausted = page.nextCursor === null
      sessions.push(
        ...page.sessions.filter(
          (session) =>
            (source === undefined || session.source === source) &&
            (projectNeedle === undefined ||
              session.projectDisplayPath.toLowerCase().includes(projectNeedle)),
        ),
      )
    }

    emitted += sessions.length
    return { sessions, hasMore: !exhausted && emitted < maxResults }
  }
}

export const listCommand = new Command('list')
  .description('List recent AI sessions')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('-s, --source <name>', 'Filter by source: claude|codex|gemini|opencode|pi')
  .option('-p, --project <path>', 'Filter by project path substring')
  .option('-a, --all', 'List across all projects (ignore cwd)')
  .option('--json', 'Output as JSON')
  .action(async (opts: ListCommandOptions, command: Command) => {
    await handleListCommand(opts, {
      ui: createClackUi(),
      limitExplicit: command.getOptionValueSource('limit') === 'cli',
    })
  })
