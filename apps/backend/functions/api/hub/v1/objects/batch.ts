import type { PagesFunction } from '@cloudflare/workers-types'

import { requireHubUser, sha256Hex } from '../../../../../src/hub/auth'
import type { HubEnv } from '../../../../../src/hub/head'
import { packKeyFor, writePack } from '../../../../../src/hub/packs'
import { insertObjects, presentOids, userStorageBytes } from '../../../../../src/hub/store'
import {
  MAX_BATCH_BYTES,
  MAX_BATCH_LINES,
  OID_RE,
  USER_QUOTA_BYTES,
} from '../../../../../src/hub/wire'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { checkRate } from '../../../../../src/rate-limit'

// Step 2 of the share handshake: content-addressed object upload. Body is
// NDJSON, one `{ oid, data }` per line. Every line is re-hashed server-side;
// a single mismatch rejects the whole batch — a client that ships one bad
// hash can't be trusted about the rest. Already-stored objects are counted
// as duplicates, so retries are idempotent.

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'hub-batch-h',
      key: user.id,
      windowSec: 3600,
      max: 1200,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const raw = await ctx.request.arrayBuffer()
    if (raw.byteLength > MAX_BATCH_BYTES) {
      throw new ApiError('UNPROCESSABLE', 'batch too large')
    }

    const lines = new TextDecoder()
      .decode(raw)
      .split('\n')
      .filter((line) => line.trim().length > 0)
    if (lines.length === 0) throw new ApiError('UNPROCESSABLE', 'empty batch')
    if (lines.length > MAX_BATCH_LINES) {
      throw new ApiError('UNPROCESSABLE', 'too many lines')
    }

    const entries: { oid: string; data: string }[] = []
    const seen = new Set<string>()
    for (const line of lines) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new ApiError('UNPROCESSABLE', 'invalid ndjson line')
      }
      const oid = (parsed as { oid?: unknown }).oid
      const data = (parsed as { data?: unknown }).data
      if (typeof oid !== 'string' || !OID_RE.test(oid) || typeof data !== 'string') {
        throw new ApiError('UNPROCESSABLE', 'line must be { oid, data }')
      }
      if (await sha256Hex(data) !== oid) {
        throw new ApiError('UNPROCESSABLE', 'oid does not match data', { oid })
      }
      if (seen.has(oid)) continue
      seen.add(oid)
      entries.push({ oid, data })
    }

    const present = await presentOids(ctx.env.DB, user.id, entries.map((e) => e.oid))
    const fresh = entries.filter((e) => !present.has(e.oid))
    if (fresh.length === 0) {
      return jsonOk({ stored: 0, duplicate: entries.length })
    }

    const encoder = new TextEncoder()
    const freshBytes = fresh.reduce((total, e) => total + encoder.encode(e.data).byteLength, 0)
    const used = await userStorageBytes(ctx.env.DB, user.id)
    if (used + freshBytes > USER_QUOTA_BYTES) {
      throw new ApiError('UNPROCESSABLE', 'storage quota exceeded')
    }

    const packKey = packKeyFor(user.id, crypto.randomUUID())
    const placements = await writePack(ctx.env.HUB, packKey, fresh)
    await insertObjects(ctx.env.DB, user.id, packKey, placements, Date.now())

    return jsonOk({ stored: fresh.length, duplicate: entries.length - fresh.length })
  } catch (e) {
    return jsonError(e)
  }
}
