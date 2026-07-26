import { z } from 'zod'

import { ApiError } from '../errors'
import { PROJECT_ID_RE, TEAM_ID_RE } from '../hub/wire'
import { MAX_PROJECT_DESCRIPTION_BYTES } from './limits'

const MAX_NAME_CHARS = 80
const MAX_GITHUB_URL_CHARS = 512
const MAX_IDEMPOTENCY_KEY_CHARS = 200

export const PROJECT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

const ProjectName = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Array.from(value).length <= MAX_NAME_CHARS, {
    message: `must be at most ${MAX_NAME_CHARS} characters`,
  })

const ProjectSlug = z.string().trim().toLowerCase().regex(PROJECT_SLUG_RE)

const ProjectDescription = z
  .string()
  .trim()
  .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_PROJECT_DESCRIPTION_BYTES, {
    message: `must be at most ${MAX_PROJECT_DESCRIPTION_BYTES} UTF-8 bytes`,
  })
  .nullable()

const GithubUrl = z
  .string()
  .trim()
  .max(MAX_GITHUB_URL_CHARS)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com'
  }, 'must be an https://github.com URL')
  .nullable()

export const CreateProjectBody = z
  .object({
    name: ProjectName,
    slug: ProjectSlug.optional(),
    description: ProjectDescription.optional().default(null),
    github_url: GithubUrl.optional().default(null),
  })
  .strict()

export type CreateProjectInput = z.infer<typeof CreateProjectBody> & { slug: string }

export const UpdateProjectBody = z
  .object({
    name: ProjectName.optional(),
    slug: ProjectSlug.optional(),
    description: ProjectDescription.optional(),
    github_url: GithubUrl.optional(),
    // Project identity retirement is terminal. The API never exposes a
    // non-functional `archived: false` recovery option.
    archived: z.literal(true).optional(),
    expected_updated_at: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.description !== undefined ||
      value.github_url !== undefined ||
      value.archived !== undefined,
    { message: 'at least one Project field is required' },
  )

export type UpdateProjectInput = z.infer<typeof UpdateProjectBody>

export async function parseCreateProjectBody(request: Request): Promise<CreateProjectInput> {
  const parsed = CreateProjectBody.safeParse(await readJson(request))
  if (!parsed.success) {
    throw new ApiError('UNPROCESSABLE', 'invalid Project', { issues: parsed.error.issues })
  }
  return {
    ...parsed.data,
    slug: parsed.data.slug ?? slugFromName(parsed.data.name),
  }
}

export async function parseUpdateProjectBody(request: Request): Promise<UpdateProjectInput> {
  const parsed = UpdateProjectBody.safeParse(await readJson(request))
  if (!parsed.success) {
    throw new ApiError('UNPROCESSABLE', 'invalid Project update', {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

export function requireProjectId(value: unknown): string {
  const id = typeof value === 'string' ? value : ''
  if (!PROJECT_ID_RE.test(id)) throw new ApiError('NOT_FOUND')
  return id
}

export function requireProjectSlug(value: unknown): string {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!PROJECT_SLUG_RE.test(slug)) throw new ApiError('NOT_FOUND')
  return slug
}

export function requireOwnerHandle(value: unknown): string {
  const handle = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(handle)) throw new ApiError('NOT_FOUND')
  return handle
}

export function requireProjectTeamId(value: unknown): string {
  const id = typeof value === 'string' ? value : ''
  if (!TEAM_ID_RE.test(id)) throw new ApiError('NOT_FOUND')
  return id
}

export function requireProjectIdempotencyKey(request: Request, bodyValue?: string): string {
  const headerValue = request.headers.get('Idempotency-Key')?.trim()
  const normalizedBodyValue = bodyValue?.trim()
  if (
    headerValue !== undefined &&
    normalizedBodyValue !== undefined &&
    headerValue !== normalizedBodyValue
  ) {
    throw new ApiError('BAD_REQUEST', 'Idempotency-Key header and body must match')
  }
  const value = headerValue ?? normalizedBodyValue ?? ''
  if (
    value.length < 8 ||
    value.length > MAX_IDEMPOTENCY_KEY_CHARS ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ApiError('BAD_REQUEST', 'Idempotency-Key must be 8-200 printable characters')
  }
  return value
}

export function slugFromName(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (normalized && PROJECT_SLUG_RE.test(normalized)) return normalized
  return 'project'
}

export function newProjectId(): string {
  return `project_${crypto.randomUUID().replaceAll('-', '')}`
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid json')
  }
}
