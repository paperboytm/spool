import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import type { WorkosTeamEnv } from './workos-client'

export type TeamApiEnv = WorkosTeamEnv & {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  WORKOS_OPERATIONS_TOKEN?: string
  WORKOS_BOOTSTRAP_TOKEN?: string
  PUBLIC_BASE_URL?: string
}
