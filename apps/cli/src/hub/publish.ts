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
      /** Explicit personal disclosure, or omit for the provider-aware default. */
      visibility?: 'public' | 'link-only'
      teamId?: never
    }
  | {
      /** Team is always an explicit tenant target; its id cannot accompany Public/Link-only. */
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
  if (options.visibility === 'team' ? !options.teamId : options.teamId !== undefined) {
    throw new Error('Team publishing requires visibility "team" and a Team id together')
  }
  const spoolFile = options.spoolFile ?? null
  const summary = options.summary?.trim() ? options.summary : null
  const target =
    options.visibility === 'team'
      ? { visibility: options.visibility, teamId: options.teamId }
      : options.visibility === undefined
        ? {}
        : { visibility: options.visibility }
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
