import { Command } from 'commander'
import { getDB, searchFragments } from '@spool-lab/core'
import type { FragmentResult, SessionSource } from '@spool-lab/core'

const SESSION_SOURCES = new Set(['claude', 'codex', 'gemini', 'antigravity', 'opencode'])

export const searchCommand = new Command('search')
  .description('Search your AI session history')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', '10')
  .option('-s, --source <name>', 'Filter by source: claude|codex|gemini|antigravity|opencode')
  .option('--since <date>', 'Only search sessions after this date (ISO or relative like "7d")')
  .option('--json', 'Output as JSON')
  .action(async (query: string, opts: { limit: string; source?: string; since?: string; json?: boolean }) => {
    const db = getDB(true)

    const since = opts.since ? resolveSince(opts.since) : undefined
    const source = opts.source && SESSION_SOURCES.has(opts.source) ? opts.source as SessionSource : undefined
    const results = searchFragments(db, query, {
      limit: parseInt(opts.limit, 10),
      ...(source !== undefined && { source }),
      ...(since !== undefined && { since }),
    })

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    if (results.length === 0) {
      console.log('No results found.')
      console.log('Tip: run `spool sync` to index new sessions, or try broader search terms.')
      return
    }

    for (const result of results) {
      printResult(result, results.indexOf(result) + 1, results.length)
    }
  })

function printResult(r: FragmentResult, n: number, total: number): void {
  const divider = '─'.repeat(60)
  console.log(`\n${divider}`)
  console.log(`Result ${n}/${total}`)
  console.log(`${divider}`)
  console.log(`Source:  ${r.source}`)
  console.log(`Project: ${r.project}`)
  console.log(`Session: "${r.sessionTitle}"`)
  console.log(`Date:    ${formatDate(r.startedAt)}`)
  console.log(`UUID:    ${r.sessionUuid}`)

  const resumeCmd = buildResumeCommand(r)
  if (resumeCmd) console.log(`Resume:  ${resumeCmd}`)

  console.log(``)
  const snippet = r.snippet
    .replace(/<mark>/g, '\x1b[1m\x1b[33m')
    .replace(/<\/mark>/g, '\x1b[0m')
  console.log(`  ${snippet}`)
}

function buildResumeCommand(r: FragmentResult): string | null {
  switch (r.source) {
    case 'claude':
      return `claude -r ${r.sessionUuid}`
    case 'codex':
      return `codex resume ${r.sessionUuid}`
    default:
      return null
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function resolveSince(value: string): string {
  // Handle relative like "7d", "30d", "1h"
  const match = value.match(/^(\d+)([dhm])$/)
  if (match) {
    const n = parseInt(match[1]!, 10)
    const unit = match[2]
    const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000
    return new Date(Date.now() - ms).toISOString()
  }
  return value // assume ISO date
}
