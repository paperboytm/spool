import {
  getDB,
  listRecentSessionsPage,
  listSessionsByIdentity,
  resolveLocalProjectIdentity,
} from '@spool-lab/core'
import { Command } from 'commander'

import { printSession } from '../format.js'

const SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode', 'pi'])

export const listCommand = new Command('list')
  .description('List recent AI sessions')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('-s, --source <name>', 'Filter by source: claude|codex|gemini|opencode|pi')
  .option('-p, --project <path>', 'Filter by project path substring')
  .option('-a, --all', 'List across all projects (ignore cwd)')
  .option('--json', 'Output as JSON')
  .action(
    (opts: { limit: string; source?: string; project?: string; all?: boolean; json?: boolean }) => {
      const db = getDB(true)
      const limit = parseInt(opts.limit, 10)
      const queryLimit = limit * 2
      let sessions = opts.all
        ? listRecentSessionsPage(db, { limit: queryLimit }).sessions
        : listSessionsByIdentity(db, resolveLocalProjectIdentity(db, process.cwd()).key, {
            limit: queryLimit,
          }).sessions

      if (opts.source && SESSION_SOURCES.has(opts.source)) {
        sessions = sessions.filter((s) => s.source === opts.source)
      }
      if (opts.project) {
        const needle = opts.project.toLowerCase()
        sessions = sessions.filter((s) => s.projectDisplayPath.toLowerCase().includes(needle))
      }

      sessions = sessions.slice(0, limit)

      if (opts.json) {
        console.log(JSON.stringify(sessions, null, 2))
        return
      }

      if (sessions.length === 0) {
        if (!opts.all && listRecentSessionsPage(db, { limit: 1 }).sessions.length > 0) {
          console.log(
            'No sessions found for the current project. Run `spool list --all` to search all projects.',
          )
          return
        }
        console.log('No sessions found. Run `spool sync` to index sessions.')
        return
      }

      for (const s of sessions) {
        printSession(s)
      }
    },
  )
