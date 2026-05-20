import { Command } from 'commander'
import { getDB, getStatus } from '@spool-lab/core'

export const statusCommand = new Command('status')
  .description('Show index status')
  .action(() => {
    try {
      const db = getDB(true)
      const s = getStatus(db)
      console.log(`DB:           ${s.dbPath}`)
      console.log(`Size:         ${formatBytes(s.dbSizeBytes)}`)
      console.log(`Sessions:     ${s.totalSessions} total  (claude: ${s.claudeSessions}, codex: ${s.codexSessions}, gemini: ${s.geminiSessions}, opencode: ${s.opencodeSessions})`)
      console.log(`Last synced:  ${s.lastSyncedAt ? formatDate(s.lastSyncedAt) : 'never'}`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('SQLITE_CANTOPEN')) {
        console.log('No index found. Run `spool sync` to create it.')
      } else {
        console.error('Failed to read index:', err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    }
  })

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try { return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString() } catch { return iso }
}
