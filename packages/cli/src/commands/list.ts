import { Command } from 'commander'
import { getDB, listRecentSessionsPage } from '@spool-lab/core'
import type { Session } from '@spool-lab/core'

const SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode'])

export const listCommand = new Command('list')
  .description('List recent AI sessions')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('-s, --source <name>', 'Filter by source: claude|codex|gemini|opencode')
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

function printSession(s: Session): void {
  const date = formatDate(s.startedAt)
  const source = s.source.padEnd(7)
  const project = s.projectDisplayName.slice(0, 20).padEnd(20)
  const title = (s.title ?? '(no title)').slice(0, 50)
  console.log(`${source} ${date}  ${project}  ${title}`)
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso.slice(0, 10)
  }
}
