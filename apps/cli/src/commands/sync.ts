import { Command } from 'commander'
import { getDB, Syncer, SpoolWatcher } from '@spool-lab/core'

export const syncCommand = new Command('sync')
  .description('Sync AI sessions to the local index')
  .option('--watch', 'Stay running and watch for new sessions')
  .action((opts: { watch?: boolean }) => {
    const db = getDB()
    const syncer = new Syncer(db, (e) => {
      if (e.phase === 'scanning') {
        process.stdout.write(`Scanning... found ${e.total} session files\r`)
      } else if (e.phase === 'syncing') {
        process.stdout.write(`Syncing ${e.count}/${e.total}...\r`)
      } else if (e.phase === 'done') {
        process.stdout.write(' '.repeat(40) + '\r')
      }
    })

    console.log('Syncing sessions...')
    const result = syncer.syncAll()
    console.log(`Done: +${result.added} added, ${result.updated} updated, ${result.errors} errors`)

    if (opts.watch) {
      console.log('Watching for new sessions (Ctrl+C to stop)...')
      const watcher = new SpoolWatcher(syncer)
      watcher.on('new-sessions', (_event, data) => {
        console.log(`[${new Date().toLocaleTimeString()}] +${data.count} new session(s) indexed`)
      })
      watcher.on('error', (_event, data) => {
        console.error(`[${new Date().toLocaleTimeString()}] watcher error:`, data.error, data.root ? `(root=${data.root})` : '')
      })
      watcher.start()

      process.on('SIGINT', () => {
        watcher.stop()
        process.exit(0)
      })
    }
  })
