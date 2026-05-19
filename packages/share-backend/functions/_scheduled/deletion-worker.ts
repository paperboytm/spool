// Scheduled deletion worker.
//
// Pages Functions do not support cron triggers directly; this file is
// shaped as a standard Workers `scheduled` handler so it can be wired up
// as a separate Worker project (using the same D1 / KV / R2 bindings)
// in deployment. The cron is declared in wrangler.toml under [triggers]
// for documentation; the actual cron registration happens on the
// companion Worker.

import type {
  D1Database,
  KVNamespace,
  R2Bucket,
  ScheduledEvent,
} from '@cloudflare/workers-types'

export type DeletionEnv = {
  DB: D1Database
  META: KVNamespace
  SNAPSHOTS: R2Bucket
  OG: R2Bucket
}

export async function runDeletionSweep(env: DeletionEnv, now: number): Promise<void> {
  const due = await env.DB.prepare(
    'SELECT user_id FROM deletion_queue WHERE scheduled_at <= ? AND cancelled = 0',
  )
    .bind(now)
    .all<{ user_id: string }>()

  for (const row of due.results) {
    try {
      const shares = await env.DB.prepare(
        'SELECT id FROM published_shares WHERE user_id=?',
      )
        .bind(row.user_id)
        .all<{ id: string }>()

      for (const s of shares.results) {
        await env.META.put(
          `meta/${s.id}`,
          JSON.stringify({
            owner: row.user_id,
            revoked_at: now,
            expires_at: null,
            visibility: 'unlisted',
            version: 0,
          }),
        )
        await env.SNAPSHOTS.delete(`${s.id}.json`)
        await env.OG.delete(`${s.id}.png`)
      }

      await env.DB.prepare(
        'UPDATE published_shares SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
      )
        .bind(now, row.user_id)
        .run()

      await env.DB.prepare(
        'UPDATE handles SET released_at=? WHERE user_id=? AND released_at IS NULL',
      )
        .bind(now, row.user_id)
        .run()

      await env.DB.prepare(
        "UPDATE users SET email='[deleted]', name=NULL, avatar_url=NULL, deleted_at=? WHERE id=?",
      )
        .bind(now, row.user_id)
        .run()

      await env.DB.prepare('DELETE FROM deletion_queue WHERE user_id=?')
        .bind(row.user_id)
        .run()
    } catch {
      // log + continue; one bad user shouldn't block the rest.
    }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: DeletionEnv): Promise<void> {
    await runDeletionSweep(env, Date.now())
  },
}
