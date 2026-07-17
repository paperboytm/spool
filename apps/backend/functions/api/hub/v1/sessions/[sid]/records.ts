import type { PagesFunction } from '@cloudflare/workers-types'

import { requireReadableSession, type HubEnv } from '../../../../../../src/hub/head'
import { readManifest, readObjects } from '../../../../../../src/hub/packs'
import { locateObjects } from '../../../../../../src/hub/store'
import { MAX_READ_BYTES, MAX_RECORDS_PER_READ, requireSid } from '../../../../../../src/hub/wire'
import { ApiError, jsonError } from '../../../../../../src/errors'

// Batched record read: NDJSON lines `{ i, oid, data }`, in sequence order.
// `from`/`to` are clamped to the published record_count and to the per-read
// caps; when the byte cap truncates the requested range the client simply
// sees fewer lines and continues from the last `i + 1`. Output is a pure
// function of (root, from, to), so it caches hard.

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const session = await requireReadableSession(ctx.env.DB, sid)

    const url = new URL(ctx.request.url)
    const from = parseBound(url.searchParams.get('from'), 0)
    const requestedTo = parseBound(url.searchParams.get('to'), from + MAX_RECORDS_PER_READ)
    const to = Math.min(requestedTo, session.record_count, from + MAX_RECORDS_PER_READ)
    if (from < 0 || to <= from) throw new ApiError('BAD_REQUEST', 'bad range')

    const etag = `W/"${session.root}:${from}-${to}"`
    if (ctx.request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag } })
    }

    const manifest = await readManifest(ctx.env.HUB, session.root)
    if (!manifest || manifest.length < session.record_count) {
      throw new ApiError('INTERNAL', 'manifest missing')
    }

    const oids = manifest.slice(from, to)
    const located = await locateObjects(ctx.env.DB, session.owner_user_id, oids)
    const locations = oids.map((oid) => {
      const location = located.get(oid)
      if (!location) throw new ApiError('INTERNAL', 'record object missing')
      return location
    })
    const bodies = await readObjects(ctx.env.HUB, locations)

    const encoder = new TextEncoder()
    const lines: string[] = []
    let bytes = 0
    for (let index = 0; index < oids.length; index += 1) {
      const oid = oids[index] as string
      const data = bodies.get(oid)
      if (data === undefined) throw new ApiError('INTERNAL', 'record object unreadable')
      const line = JSON.stringify({ i: from + index, oid, data }) + '\n'
      bytes += encoder.encode(line).byteLength
      if (lines.length > 0 && bytes > MAX_READ_BYTES) break
      lines.push(line)
    }

    return new Response(lines.join(''), {
      headers: {
        'content-type': 'application/x-ndjson',
        'cache-control': 'public, max-age=3600',
        etag,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

function parseBound(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError('BAD_REQUEST', 'bad range')
  }
  return value
}
