import { Command } from 'commander'
import { getDB, listProjectGroups } from '@spool-lab/core'
import { formatDate } from '../format.js'

export const projectsCommand = new Command('projects')
  .description('List your projects, grouped across sources')
  .option('--json', 'Output as JSON')
  .action((opts: { json?: boolean }) => {
    const db = getDB(true)
    const groups = listProjectGroups(db)

    if (opts.json) {
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
  })
