export type ErrorCode =
  | 'BAD_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'GONE' | 'CONFLICT' | 'TOO_MANY_REQUESTS' | 'UNPROCESSABLE'
  | 'INTERNAL'

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  GONE: 410, CONFLICT: 409, TOO_MANY_REQUESTS: 429, UNPROCESSABLE: 422,
  INTERNAL: 500,
}

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public detail?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(detail ?? code)
  }
}

export function jsonError(e: unknown): Response {
  const err = e instanceof ApiError ? e : new ApiError('INTERNAL', 'unexpected')
  return new Response(
    JSON.stringify({ error: err.code, detail: err.detail, ...err.extra }),
    {
      status: STATUS[err.code],
      headers: { 'content-type': 'application/json' },
    },
  )
}
