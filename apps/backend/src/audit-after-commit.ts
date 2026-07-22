import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { audit } from './audit'

type PostCommitAuditContext = {
  env: { DB: D1Database; RATE: KVNamespace }
  request: Request
  waitUntil(promise: Promise<unknown>): void
}

type AuditEntry = Parameters<typeof audit>[3]

/**
 * Business state is authoritative once its D1/WorkOS commit succeeds. Audit
 * delivery remains observable, but a transient KV or audit_log failure must
 * never turn that committed operation into a misleading 5xx and invite a
 * destructive client retry.
 */
export function auditAfterCommit(ctx: PostCommitAuditContext, entry: AuditEntry): void {
  ctx.waitUntil(
    audit(ctx.env.DB, ctx.env.RATE, ctx.request, entry).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: 'post-commit audit failed',
          action: entry.action,
          targetId: entry.target_id ?? null,
          userId: entry.user_id ?? null,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }),
  )
}
