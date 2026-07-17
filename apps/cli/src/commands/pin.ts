import { Command } from 'commander'
import {
  getDB,
  getSessionWithMessages,
  isPinned,
  listPinnedSessions,
  pinSession,
  unpinSession,
} from '@spool-lab/core'
import { printSession } from '../format.js'

export const pinCommand = new Command('pin')
  .description('Pin a session so it stays at the top of your library')
  .argument('<uuid>', 'Session UUID')
  .action((uuid: string) => {
    const db = getDB(true)
    const result = getSessionWithMessages(db, uuid)
    if (!result) {
      console.error(`Session not found: ${uuid}`)
      process.exit(1)
    }

    const label = result.session.title ?? uuid
    if (isPinned(db, uuid)) {
      console.log(`Already pinned: ${label}`)
      return
    }
    pinSession(db, uuid)
    console.log(`Pinned: ${label}`)
  })

export const unpinCommand = new Command('unpin')
  .description('Remove a session from your pinned list')
  .argument('<uuid>', 'Session UUID')
  .action((uuid: string) => {
    const db = getDB(true)
    if (!isPinned(db, uuid)) {
      console.log(`Not pinned: ${uuid}`)
      return
    }
    unpinSession(db, uuid)
    console.log(`Unpinned: ${uuid}`)
  })

export const pinnedCommand = new Command('pinned')
  .description('List pinned sessions')
  .option('--json', 'Output as JSON')
  .action((opts: { json?: boolean }) => {
    const db = getDB(true)
    const sessions = listPinnedSessions(db)

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2))
      return
    }

    if (sessions.length === 0) {
      console.log('No pinned sessions. Pin one with `spool pin <uuid>`.')
      return
    }

    for (const s of sessions) {
      printSession(s)
    }
  })
