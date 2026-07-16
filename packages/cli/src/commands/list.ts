import { Command } from 'commander'
import { getDB, listRecentSessionsPage } from '@spool-lab/core'
import { printSession } from '../format.js'

const SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'antigravity', 'opencode'])

export const listCommand = new Command('list')
  .description('List recent AI sessions')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('-s, --source <name>', 'Filter by source: claude|codex|gemini|antigravity|opencode')
  .option('-p, --project <path>', 'Filter by project path substring')
  .option('--json', 'Output as JSON')
  .action((opts: { limit: string; source?: string; project?: string; json?: boolean }) => {
    const db = getDB(true)
    let sessions = listRecentSessionsPage(db, { limit: parseInt(opts.limit, 10) * 2 }).sessions

    if (opts.source && SESSION_SOURCES.has(opts.source)) {
      sessions = sessions.filter(s => s.source === opts.source)
    }
    if (opts.project) {
      const needle = opts.project.toLowerCase()
      sessions = sessions.filter(s => s.projectDisplayPath.toLowerCase().includes(needle))
    }

    sessions = sessions.slice(0, parseInt(opts.limit, 10))

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2))
      return
    }

    if (sessions.length === 0) {
      console.log('No sessions found. Run `spool sync` to index sessions.')
      return
    }

    for (const s of sessions) {
      printSession(s)
    }
  })
