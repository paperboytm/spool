import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import type { DiscoveryEngagementResponse } from '@spool-lab/session-kit'

import { base64urlFromBuffer, sha256 } from '../auth/pkce'
import { ApiError } from '../errors'
import { checkRate } from '../rate-limit'
import { clientIp } from '../request'
import { incrementQualifiedRead, isDiscoverySessionLive } from './store'

const MAX_BODY_BYTES = 1024
const DEDUPE_TTL_SEC = 2 * 24 * 60 * 60
const RATE_WINDOW_SEC = 60
const RATE_MAX = 60

export async function recordQualifiedRead(
  db: D1Database,
  kv: KVNamespace,
  request: Request,
  sid: string,
  now = Date.now(),
): Promise<DiscoveryEngagementResponse> {
  await requireQualifiedReadBody(request)
  if (!(await isDiscoverySessionLive(db, sid))) throw new ApiError('NOT_FOUND')

  const day = new Date(now).toISOString().slice(0, 10)
  const ip = clientIp(request)
  const userAgent = request.headers.get('User-Agent') ?? '-'
  const readerDigest = base64urlFromBuffer(await sha256(`${ip}\n${userAgent}\n${day}`))
  const rate = await checkRate(kv, {
    bucket: 'discovery-engagement',
    key: readerDigest,
    windowSec: RATE_WINDOW_SEC,
    max: RATE_MAX,
  })
  if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS', 'rate limit exceeded')

  const dedupeDigest = base64urlFromBuffer(await sha256(`${ip}\n${userAgent}\n${sid}\n${day}`))
  const dedupeKey = `discovery/qualified-read/${day}/${dedupeDigest}`
  if ((await kv.get(dedupeKey)) !== null) return { accepted: false }

  await kv.put(dedupeKey, '1', { expirationTtl: DEDUPE_TTL_SEC })
  try {
    await incrementQualifiedRead(db, sid, day)
  } catch (error) {
    // Let a retry count if D1 failed after the KV reservation.
    try {
      await kv.delete(dedupeKey)
    } catch {
      // The original D1 error remains the actionable failure.
    }
    throw error
  }
  return { accepted: true }
}

async function requireQualifiedReadBody(request: Request): Promise<void> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiError('BAD_REQUEST', 'content-type must be application/json')
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      throw new ApiError('BAD_REQUEST', 'request body is too large')
    }
  }

  const bytes = await readBoundedBody(request, MAX_BODY_BYTES)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid json')
  }
  if (!isObject(value) || value['kind'] !== 'qualified_read' || Object.keys(value).length !== 1) {
    throw new ApiError('BAD_REQUEST', 'kind must be qualified_read')
  }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (request.body === null) throw new ApiError('BAD_REQUEST', 'request body is required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ApiError('BAD_REQUEST', 'request body is too large')
    }
    chunks.push(result.value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
