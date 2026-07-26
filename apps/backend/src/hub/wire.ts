import { z } from 'zod'

import { ApiError } from '../errors'

// Wire spec for the Hub API — see docs/product-architecture.zh-CN.md. The sid is
// '<provider>_<provider-session-uuid>'; oids are lowercase hex sha256 of
// canonical record bytes. Limits guard D1/R2 from hostile payloads, not
// legitimate sessions.

export const OID_RE = /^[0-9a-f]{64}$/
export const SID_RE = /^(claude|codex|gemini|opencode|pi)_[0-9A-Za-z_-]{8,128}$/
export const TEAM_ID_RE = /^[0-9A-Za-z_-]{8,128}$/
export const PROJECT_ID_RE = /^project_[0-9A-Za-z_-]{8,192}$/

export const MAX_MANIFEST = 100_000
export const MAX_SUMMARY_BYTES = 64 * 1024
export const MAX_CARD_BYTES = 64 * 1024
export const MAX_LINEAGE_BYTES = 4 * 1024
export const MAX_BATCH_BYTES = 32 * 1024 * 1024
export const MAX_BATCH_LINES = 4000
export const MAX_RECORDS_PER_READ = 500
export const MAX_READ_BYTES = 8 * 1024 * 1024
export const USER_QUOTA_BYTES = 1024 * 1024 * 1024
export const TEAM_QUOTA_BYTES = 5 * 1024 * 1024 * 1024

const boundedText = (maxBytes: number) =>
  z.string().refine((value) => new TextEncoder().encode(value).byteLength <= maxBytes, {
    message: `must be at most ${maxBytes} bytes`,
  })

const summaryMarkdown = boundedText(MAX_SUMMARY_BYTES).nullable()

export const HeadBody = z
  .object({
    root: z.string().regex(OID_RE),
    count: z.number().int().min(1).max(MAX_MANIFEST),
    manifest: z.array(z.string().regex(OID_RE)).min(1).max(MAX_MANIFEST),
    sig: z.string().max(512).nullable(),
    cardJson: boundedText(MAX_CARD_BYTES).nullable(),
    summaryMd: summaryMarkdown.optional(),
    // Rolling-upgrade alias for clients released before Summary replaced Note.
    noteMd: summaryMarkdown.optional(),
    lineageJson: boundedText(MAX_LINEAGE_BYTES).nullable(),
    viewOid: z.string().regex(OID_RE),
    // Optional curated .spool document (content-addressed, rides through
    // objects/batch like the view). Default keeps older clients valid.
    spoolFileOid: z.string().regex(OID_RE).nullable().default(null),
    // Optional in the rolling protocol. Older clients omit both fields and
    // keep the current tenant/access state (or use the provider default for
    // a new Session). Team visibility is never inferred from a UI switcher.
    visibility: z.enum(['public', 'link-only', 'team']).optional(),
    teamId: z.string().regex(TEAM_ID_RE).nullable().optional(),
    // Optional optimistic tenant precondition. Explicit null means the caller
    // observed a personal/new Session; omission keeps older clients working.
    expectedTeamId: z.string().regex(TEAM_ID_RE).nullable().optional(),
    // Project is an independent grouping inside the durable tenant. Older
    // clients omit it and are assigned to the tenant's deterministic default;
    // explicit null requests that same default without ever persisting NULL.
    projectId: z.string().regex(PROJECT_ID_RE).nullable().optional(),
    // Optional optimistic Project precondition. A client moving an existing
    // Session must send the Project it reviewed so a concurrent move fails
    // closed instead of being overwritten by a later head commit.
    expectedProjectId: z.string().regex(PROJECT_ID_RE).nullable().optional(),
  })
  .superRefine((body, context) => {
    if (body.summaryMd === undefined && body.noteMd === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['summaryMd'],
        message: 'required',
      })
    }
  })
  .transform(({ noteMd, summaryMd, ...body }) => ({
    ...body,
    summaryMd: summaryMd === undefined ? (noteMd ?? null) : summaryMd,
  }))
export type HeadBodyT = z.infer<typeof HeadBody>

export function requireSid(params: unknown): string {
  const sid = typeof params === 'string' ? params : ''
  if (!SID_RE.test(sid)) throw new ApiError('BAD_REQUEST', 'bad session id')
  return sid
}

export async function parseHeadBody(request: Request): Promise<HeadBodyT> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    throw new ApiError('UNPROCESSABLE', 'invalid json')
  }
  const parsed = HeadBody.safeParse(json)
  if (!parsed.success) {
    throw new ApiError('UNPROCESSABLE', 'invalid head', { issues: parsed.error.issues })
  }
  if (parsed.data.manifest.length !== parsed.data.count) {
    throw new ApiError('UNPROCESSABLE', 'manifest length must equal count')
  }
  return parsed.data
}
