import { z } from 'zod'

import { ApiError } from '../errors'

const TeamName = z
  .string()
  .transform((value) => value.normalize('NFKC'))
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'control characters are not allowed')
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(80))
const InvitableRole = z.enum(['admin', 'member'])

const CreateTeamBody = z.object({ name: TeamName }).strict()
const UpdateTeamBody = z.object({ name: TeamName }).strict()
const InviteBody = z.object({ email: z.email().trim().max(254), role: InvitableRole }).strict()
const UpdateMemberBody = z.object({ role: z.enum(['owner', 'admin', 'member']) }).strict()

async function parse<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid json')
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new ApiError('UNPROCESSABLE', 'invalid request', { issues: result.error.issues })
  }
  return result.data
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key') ?? ''
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'valid Idempotency-Key header required')
  }
  return value
}

export function requireTeamId(value: unknown): string {
  const id = typeof value === 'string' ? value : ''
  if (!/^team_[0-9a-f]{32}$/.test(id)) throw new ApiError('NOT_FOUND')
  return id
}

export function requireUserId(value: unknown): string {
  const id = typeof value === 'string' ? value : ''
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new ApiError('NOT_FOUND')
  return id
}

export function requireInvitationId(value: unknown): string {
  const id = typeof value === 'string' ? value : ''
  if (!/^tinv_[0-9a-f]{32}$/.test(id)) throw new ApiError('NOT_FOUND')
  return id
}

export const parseCreateTeamBody = (request: Request) => parse(request, CreateTeamBody)
export const parseUpdateTeamBody = (request: Request) => parse(request, UpdateTeamBody)
export const parseInviteBody = (request: Request) => parse(request, InviteBody)
export const parseUpdateMemberBody = (request: Request) => parse(request, UpdateMemberBody)
