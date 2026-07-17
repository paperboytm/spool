import type { R2Bucket } from '@cloudflare/workers-types'

import { ApiError } from '../errors'

import type { ObjectLocation } from './store'

// Packs are uncompressed concatenations of canonical record bytes — offsets
// must stay byte-addressable for R2 ranged GETs (transport compression is
// Cloudflare's job). One pack per accepted upload batch.

export type PackPlacement = { oid: string; offset: number; length: number }

export function packKeyFor(userId: string, packId: string): string {
  return `hub/packs/${userId}/${packId}`
}

export function manifestKeyFor(root: string): string {
  return `hub/manifests/${root}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function writePack(
  bucket: R2Bucket,
  packKey: string,
  entries: readonly { oid: string; data: string }[],
): Promise<PackPlacement[]> {
  const placements: PackPlacement[] = []
  const chunks: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const bytes = encoder.encode(entry.data)
    placements.push({ oid: entry.oid, offset, length: bytes.byteLength })
    chunks.push(bytes)
    offset += bytes.byteLength
  }
  const pack = new Uint8Array(offset)
  let cursor = 0
  for (const chunk of chunks) {
    pack.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  await bucket.put(packKey, pack, {
    httpMetadata: { contentType: 'application/octet-stream' },
  })
  return placements
}

/**
 * Read many objects with one ranged GET per pack: fetch the [min, max) span
 * of the needed placements in each pack and slice records out of it. Packs
 * are bounded by the per-batch upload cap, so a worst-case span is bounded
 * too; typical reads are contiguous ranges of one session's records.
 */
export async function readObjects(
  bucket: R2Bucket,
  locations: readonly ObjectLocation[],
): Promise<Map<string, string>> {
  const byPack = new Map<string, ObjectLocation[]>()
  for (const location of locations) {
    const group = byPack.get(location.pack_key)
    if (group) group.push(location)
    else byPack.set(location.pack_key, [location])
  }

  const out = new Map<string, string>()
  for (const [packKey, group] of byPack) {
    const spanStart = Math.min(...group.map((l) => l.offset))
    const spanEnd = Math.max(...group.map((l) => l.offset + l.length))
    const object = await bucket.get(packKey, {
      range: { offset: spanStart, length: spanEnd - spanStart },
    })
    if (!object) throw new ApiError('INTERNAL', 'pack missing')
    const span = new Uint8Array(await object.arrayBuffer())
    for (const location of group) {
      const start = location.offset - spanStart
      out.set(location.oid, decoder.decode(span.subarray(start, start + location.length)))
    }
  }
  return out
}

export async function writeManifest(
  bucket: R2Bucket,
  root: string,
  manifest: readonly string[],
): Promise<void> {
  await bucket.put(manifestKeyFor(root), manifest.join('\n') + '\n', {
    httpMetadata: { contentType: 'application/x-ndjson' },
  })
}

export async function readManifest(bucket: R2Bucket, root: string): Promise<string[] | null> {
  const object = await bucket.get(manifestKeyFor(root))
  if (!object) return null
  const text = await object.text()
  return text.split('\n').filter((line) => line.length > 0)
}
