import { SESSION_PROVIDERS, type SessionProvider } from '@spool-lab/session-kit'

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const PROVIDER_PATTERN = SESSION_PROVIDERS.join('|')
const SESSION_ID_PATTERN = `[0-9A-Za-z_-]{8,128}`
const SESSION_REF_PATTERN = new RegExp(
  `^((?:${PROVIDER_PATTERN})_(?:${UUID_PATTERN}|${SESSION_ID_PATTERN}))(?:@(0|[1-9][0-9]*))?$`,
)

export type SessionRefProvider = SessionProvider

export interface ResolvedSessionRef {
  sid: string
  provider: SessionRefProvider
  position?: number
  hubUrl?: string
}

export function resolveSessionRef(input: string): ResolvedSessionRef {
  const value = input.trim()

  if (value.startsWith('https://') || value.startsWith('http://')) {
    return resolveShareUrl(value)
  }

  return parseSidAndPosition(value) ?? invalidSessionRef(input)
}

function resolveShareUrl(value: string): ResolvedSessionRef {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalidSessionRef(value)
  }

  // http is tolerated only for loopback hosts — local `wrangler pages dev`
  // hubs; anything else must be https.
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return invalidSessionRef(value)
  }

  const pathMatch = url.pathname.match(/^\/session\/([^/]+)$/)
  if (!pathMatch?.[1]) return invalidSessionRef(value)

  const resolved = parseSidAndPosition(pathMatch[1])
  if (!resolved) return invalidSessionRef(value)
  return { ...resolved, hubUrl: url.origin }
}

function parseSidAndPosition(value: string): ResolvedSessionRef | undefined {
  const match = value.match(SESSION_REF_PATTERN)
  const sid = match?.[1]
  if (!sid) return undefined
  const provider = sid.slice(0, sid.indexOf('_')) as SessionRefProvider

  const rawPosition = match[2]
  if (rawPosition === undefined) return { sid, provider }

  const position = Number(rawPosition)
  if (!Number.isSafeInteger(position)) return undefined
  return { sid, provider, position }
}

function invalidSessionRef(input: string): never {
  throw new Error(
    `Invalid session reference: ${input || '(empty)'}. Expected <provider>_<session-id> or an https://<host>/session/<sid> URL, optionally followed by @<n>.`,
  )
}
