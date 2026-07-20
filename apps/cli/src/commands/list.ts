import {
  formatCliCommand,
  getDB,
  listRecentSessionsPage,
  listSessionsByIdentity,
  resolveLocalProjectIdentity,
  type Session,
  type SessionsCursor,
} from '@spool-lab/core'
import { isSessionProvider, SESSION_PROVIDERS } from '@spool-lab/session-kit'
import { Command } from 'commander'

import { formatDate, printSession } from '../format.js'
import { createClackUi, createTextUi, type CliSelectOption, type CliUi } from '../ui.js'
import { handleShareCommand } from './share.js'

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
  shareSession?: (sessionUuid: string, ui: CliUi) => Promise<0 | 1>
}

export async function handleListCommand(
  opts: ListCommandOptions,
  dependencies: ListCommandDependencies = {},
): Promise<0 | 1> {
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
    return 0
  }

  if (sessions.length === 0) {
    if (!opts.all && listRecentSessionsPage(db, { limit: 1 }).sessions.length > 0) {
      console.log(
        `No sessions found for the current project. Run \`${formatCliCommand('list --all')}\` to search all projects.`,
      )
      return 0
    }
    console.log(`No sessions found. Run \`${formatCliCommand('sync')}\` to index sessions.`)
    return 0
  }

  if (ui.interactive) {
    const selected = await ui.autocomplete({
      message: 'Select a Session',
      choices: sessions.map(toAutocompleteChoice),
      ...(firstPage.hasMore
        ? {
            loadMore: (search: string) => {
              const page = loadPage(search)
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
    if (selected === null) return 0

    const wantsShare = await ui.confirm(`Share Session ${selected.slice(0, 8)} as Link-only?`, true)
    if (wantsShare !== true) {
      if (wantsShare === null) ui.cancel('Session not shared.')
      else ui.outro('Session not shared.')
      return 0
    }

    const shareSession =
      dependencies.shareSession ??
      ((sessionUuid: string, shareUi: CliUi) =>
        handleShareCommand(sessionUuid, {}, { ui: shareUi }))
    return shareSession(selected, ui)
  }

  for (const session of sessions) {
    printSession(session)
  }
  return 0
}

function toAutocompleteChoice(session: Session): CliSelectOption<string> {
  const shortId = session.sessionUuid.slice(0, 8)
  return {
    value: session.sessionUuid,
    label: `${shortId}  ${session.title ?? '(no title)'}`,
    hint: `${session.source} · ${formatDate(session.startedAt)} · ${session.projectDisplayName}`,
    searchText: [
      session.sessionUuid,
      session.title ?? '',
      session.source,
      session.projectDisplayName,
      session.projectDisplayPath,
      session.cwd ?? '',
      session.startedAt,
    ].join(' '),
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
}: SessionPageLoaderOptions): (search?: string) => { sessions: Session[]; hasMore: boolean } {
  const identityKey = opts.all ? undefined : resolveLocalProjectIdentity(db, cwd).key
  const source = opts.source && isSessionProvider(opts.source) ? opts.source : undefined
  const projectNeedle = opts.project?.toLowerCase()
  const states = new Map<
    string,
    { cursor: SessionsCursor | undefined; exhausted: boolean; emitted: number }
  >()

  return (search = '') => {
    const searchKey = search.trim().toLowerCase()
    const state = states.get(searchKey) ?? {
      cursor: undefined,
      exhausted: false,
      emitted: 0,
    }
    states.set(searchKey, state)
    const target = Math.min(pageSize, maxResults - state.emitted)
    const sessions: Session[] = []

    while (sessions.length < target && !state.exhausted) {
      const queryLimit = target - sessions.length
      const page = opts.all
        ? listRecentSessionsPage(db, {
            limit: queryLimit,
            ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
            ...(searchKey === '' ? {} : { search: searchKey }),
          })
        : listSessionsByIdentity(db, identityKey!, {
            limit: queryLimit,
            ...(source === undefined ? {} : { sources: [source] }),
            ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
            ...(searchKey === '' ? {} : { search: searchKey }),
          })

      state.cursor = page.nextCursor ?? undefined
      state.exhausted = page.nextCursor === null
      sessions.push(
        ...page.sessions.filter(
          (session) =>
            (source === undefined || session.source === source) &&
            (projectNeedle === undefined ||
              session.projectDisplayPath.toLowerCase().includes(projectNeedle)),
        ),
      )
    }

    state.emitted += sessions.length
    return { sessions, hasMore: !state.exhausted && state.emitted < maxResults }
  }
}

export const listCommand = new Command('list')
  .description('List recent AI sessions')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('-s, --source <name>', `Filter by source: ${SESSION_PROVIDERS.join('|')}`)
  .option('-p, --project <path>', 'Filter by project path substring')
  .option('-a, --all', 'List across all projects (ignore cwd)')
  .option('--json', 'Output as JSON')
  .action(async (opts: ListCommandOptions, command: Command) => {
    const exitCode = await handleListCommand(opts, {
      ui: createClackUi(),
      limitExplicit: command.getOptionValueSource('limit') === 'cli',
    })
    if (exitCode !== 0) process.exitCode = exitCode
  })
