import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { formatCliCommand } from '../../cli-command.js'
import { DB_PATH } from '../../db/db.js'
import { openDatabase } from '../../db/native-binding.js'
import { getStatus } from '../../db/queries.js'
import type { Check, CheckResult } from '../types.js'

// Continuous publishing health. The daemon (spool daemon run, registered via
// launchd/systemd) writes ~/.spool/daemon.json as a heartbeat; subscriptions
// live in ~/.spool/subscriptions.json. Both files are CLI-owned; this check
// only reads them so `spool doctor` reports one combined picture.

function spoolHome(): string {
  return process.env['HOME'] || homedir()
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function subscriptionCount(): number {
  const parsed = readJsonFile(join(spoolHome(), '.spool', 'subscriptions.json'))
  if (typeof parsed !== 'object' || parsed === null) return 0
  const subscriptions = (parsed as { subscriptions?: unknown }).subscriptions
  return Array.isArray(subscriptions) ? subscriptions.length : 0
}

export const daemonChecks: Check[] = [
  {
    id: 'daemon.heartbeat',
    category: 'daemon',
    title: 'Daemon heartbeat',
    run: (): CheckResult => {
      const base = {
        id: 'daemon.heartbeat',
        category: 'daemon' as const,
        title: 'Daemon heartbeat',
      }
      const subscriptions = subscriptionCount()
      const heartbeat = readJsonFile(join(spoolHome(), '.spool', 'daemon.json')) as {
        pid?: unknown
        startedAt?: unknown
        lastPassAt?: unknown
      } | null

      const running = typeof heartbeat?.pid === 'number' && processAlive(heartbeat.pid)
      if (running) {
        const lastPass =
          typeof heartbeat?.lastPassAt === 'string' ? `, last pass ${heartbeat.lastPassAt}` : ''
        return {
          ...base,
          severity: 'ok',
          message: `Running (pid ${heartbeat?.pid as number}${lastPass})`,
          details: { subscriptions },
        }
      }
      if (subscriptions === 0) {
        return {
          ...base,
          severity: 'ok',
          message: `Not running; no subscribed directories need it. Subscribe with \`${formatCliCommand('subscribe')}\`.`,
        }
      }
      return {
        ...base,
        severity: 'warn',
        message: `${subscriptions} subscribed director${subscriptions === 1 ? 'y' : 'ies'} but the daemon is not running — start it with \`${formatCliCommand('daemon start')}\``,
        details: { subscriptions },
      }
    },
  },
  {
    id: 'daemon.index',
    category: 'daemon',
    title: 'Local index',
    run: (): CheckResult => {
      const base = { id: 'daemon.index', category: 'daemon' as const, title: 'Local index' }
      let db
      try {
        db = openDatabase(DB_PATH, { readonly: true, fileMustExist: true })
      } catch {
        return {
          ...base,
          severity: 'warn',
          message: `No index at ${DB_PATH} — run \`spool\` once to create it`,
        }
      }
      try {
        const status = getStatus(db)
        const synced = status.lastSyncedAt === null ? 'never' : status.lastSyncedAt
        return {
          ...base,
          severity: 'ok',
          message: `${status.totalSessions} sessions indexed (claude ${status.claudeSessions}, codex ${status.codexSessions}, gemini ${status.geminiSessions}, opencode ${status.opencodeSessions}, pi ${status.piSessions}, zcode ${status.zcodeSessions}); last synced ${synced}`,
          details: {
            totalSessions: status.totalSessions,
            lastSyncedAt: status.lastSyncedAt,
          },
        }
      } finally {
        try {
          db.close()
        } catch {
          /* ignore */
        }
      }
    },
  },
]
