import {
  canonicalizeRecord,
  deriveView,
  sequenceRoot,
  splitRecords,
  type CanonicalRecord,
  type SessionProvider,
  type SessionViewV1,
} from '@spool-lab/session-kit'

import { extractBirthPayload } from './birth.js'

// Pure share preparation: provider JSONL in, everything the 3-step hub
// handshake needs out. No store.db in this PR — records are canonicalized
// at share time, straight from the provider file.

export interface PreparedShare {
  sid: string
  provider: SessionProvider
  count: number
  root: string
  manifest: string[]
  records: CanonicalRecord[]
  view: SessionViewV1
  viewOid: string
  viewData: string
  lineageJson: string | null
}

/** Upload batching shared by every hub publisher (CLI and app). */
export const UPLOAD_MAX_LINES = 2000
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024

export function* chunkUploads(
  uploads: readonly { oid: string; data: string }[],
): Generator<{ oid: string; data: string }[]> {
  let batch: { oid: string; data: string }[] = []
  let bytes = 0
  for (const upload of uploads) {
    const size = upload.data.length + upload.oid.length + 32
    if (batch.length > 0 && (batch.length >= UPLOAD_MAX_LINES || bytes + size > UPLOAD_MAX_BYTES)) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(upload)
    bytes += size
  }
  if (batch.length > 0) yield batch
}

export async function prepareShare(opts: {
  provider: SessionProvider
  sessionUuid: string
  jsonl: string
  /** Prefix share `@n`: only the first n records are shared. */
  position?: number
  workspaceRoot: string
  homeDir: string
}): Promise<PreparedShare> {
  const rawLines = splitRecords(opts.jsonl)
  if (rawLines.length === 0) {
    throw new Error('Session file contains no records')
  }
  if (opts.position !== undefined && (opts.position < 1 || opts.position > rawLines.length)) {
    throw new Error(
      `Prefix position @${opts.position} is out of range (session has ${rawLines.length} records)`,
    )
  }
  const shared = opts.position === undefined ? rawLines : rawLines.slice(0, opts.position)

  const records: CanonicalRecord[] = []
  for (let index = 0; index < shared.length; index += 1) {
    try {
      records.push(
        await canonicalizeRecord(shared[index] as string, {
          workspaceRoot: opts.workspaceRoot,
          homeDir: opts.homeDir,
        }),
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Record ${index} cannot be canonicalized: ${message}`)
    }
  }

  const manifest = records.map((record) => record.oid)
  const root = await sequenceRoot(manifest)
  const view = deriveView(records, { provider: opts.provider })
  // The view is itself a content-addressed object; canonicalize so author
  // and any future re-derivation agree on bytes.
  const canonicalView = await canonicalizeRecord(JSON.stringify(view))

  const birth = extractBirthPayload(records.map((record) => record.data))

  return {
    sid: `${opts.provider}_${opts.sessionUuid}`,
    provider: opts.provider,
    count: records.length,
    root,
    manifest,
    records,
    view,
    viewOid: canonicalView.oid,
    viewData: canonicalView.data,
    lineageJson: birth === null ? null : JSON.stringify(birth),
  }
}
