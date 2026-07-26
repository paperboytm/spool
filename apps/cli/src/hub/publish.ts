import {
  type HubClient,
  type HubHeadResponse,
  type HubObjectUpload,
  type HubSessionWriteRequest,
} from './client.js'
import { UPLOAD_MAX_LINES, chunkUploads, type PreparedShare } from './share-pipeline.js'
import type { WorkspaceCard } from './workspace.js'

interface PublishPreparedShareBaseOptions {
  card: WorkspaceCard | null
  /** Markdown shown as the shared session's Summary. */
  summary: string | null
  /** Optional curated .spool document attached to the share. */
  spoolFile?: HubObjectUpload | null
  onUploadProgress?: (uploaded: number, total: number) => void
  /** Fail if durable Team ownership changed after the caller reviewed it. */
  expectedTeamId?: string | null
  /** Every hosted Session belongs to one explicit Hub Project. */
  projectId: string
  /** Fail if an existing Session moved Projects after the caller read it. */
  expectedProjectId?: string | null
}

type PublishPreparedShareTarget =
  | {
      /** Omitted target keeps the Hub's provider-aware personal default. */
      visibility?: undefined
      teamId?: never
    }
  | {
      /** Public/Link-only disclosure may still live in a Team-owned Project. */
      visibility: 'public' | 'link-only'
      teamId?: string
    }
  | {
      /** Team-only disclosure always requires a durable Team owner. */
      visibility: 'team'
      teamId: string
    }

export type PublishPreparedShareOptions = PublishPreparedShareBaseOptions &
  PublishPreparedShareTarget

/**
 * Commit a prepared session through the Hub's push → upload → head protocol.
 *
 * This is the single upload seam used by `spool share` and Hub library
 * consumers. Callers prepare/review locally, then pass the accepted Markdown
 * Summary; transport ordering, head construction, and object batching stay
 * owned by the CLI package.
 */
export async function publishPreparedShare(
  client: Pick<HubClient, 'pushSession' | 'uploadObjects' | 'commitSessionHead'>,
  prepared: PreparedShare,
  options: PublishPreparedShareOptions,
): Promise<HubHeadResponse> {
  if (options.visibility === 'team' && !options.teamId) {
    throw new Error('Team-only publishing requires a Team id')
  }
  if (options.visibility === undefined && options.teamId !== undefined) {
    throw new Error('Team-owned publishing requires an explicit visibility')
  }
  const spoolFile = options.spoolFile ?? null
  const summary = options.summary?.trim() ? options.summary : null
  const target = {
    ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
    ...(options.teamId === undefined ? {} : { teamId: options.teamId }),
  }
  const ownershipExpectation =
    options.expectedTeamId === undefined ? {} : { expectedTeamId: options.expectedTeamId }
  const projectExpectation =
    options.expectedProjectId === undefined ? {} : { expectedProjectId: options.expectedProjectId }
  const head: HubSessionWriteRequest = {
    root: prepared.root,
    count: prepared.count,
    manifest: prepared.manifest,
    sig: null,
    cardJson: options.card === null ? null : JSON.stringify(options.card),
    summaryMd: summary,
    lineageJson: prepared.lineageJson,
    viewOid: prepared.viewOid,
    spoolFileOid: spoolFile?.oid ?? null,
    projectId: options.projectId,
    ...target,
    ...ownershipExpectation,
    ...projectExpectation,
  }

  const { missing } = await client.pushSession(prepared.sid, head)
  const missingSet = new Set(missing)
  const uploads: HubObjectUpload[] = [
    ...prepared.records.map((record) => ({ oid: record.oid, data: record.data })),
    { oid: prepared.viewOid, data: prepared.viewData },
    ...(spoolFile === null ? [] : [spoolFile]),
  ].filter((object) => missingSet.has(object.oid))

  let uploaded = 0
  for (const batch of chunkUploads(uploads)) {
    await client.uploadObjects(batch)
    uploaded += batch.length
    if (uploads.length > UPLOAD_MAX_LINES) {
      options.onUploadProgress?.(uploaded, uploads.length)
    }
  }

  return client.commitSessionHead(prepared.sid, head)
}
