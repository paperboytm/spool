// Typed wrappers for the CLI login approval endpoints. Same pattern as
// api.ts: narrow fetch surface, discriminated results, no thrown errors
// — the page renders every state explicitly.

export interface CliAuthInfo {
  user_code: string
  label: string | null
  created: number
}

export type CliAuthInfoResult =
  | { kind: 'ok'; info: CliAuthInfo }
  | { kind: 'unauthenticated' }
  | { kind: 'gone' }
  | { kind: 'error' }

export type CliAuthDecideResult = { kind: 'ok' } | { kind: 'gone' } | { kind: 'error' }

function decideInfoState(status: number, body: unknown): CliAuthInfoResult {
  if (status === 200) return { kind: 'ok', info: body as CliAuthInfo }
  if (status === 401) return { kind: 'unauthenticated' }
  // 404 expired/handled and 400 mangled code both read "this link is
  // dead, get a fresh one from the terminal" to a human.
  if (status === 404 || status === 400) return { kind: 'gone' }
  return { kind: 'error' }
}

export async function fetchCliAuthInfo(code: string): Promise<CliAuthInfoResult> {
  try {
    const r = await fetch(`/api/cli-auth/approve?code=${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
    })
    let body: unknown = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    return decideInfoState(r.status, body)
  } catch {
    return { kind: 'error' }
  }
}

export async function decideCliAuth(
  code: string,
  decision: 'approve' | 'deny',
): Promise<CliAuthDecideResult> {
  try {
    const r = await fetch('/api/cli-auth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ user_code: code, decision }),
    })
    if (r.status === 200) return { kind: 'ok' }
    if (r.status === 404 || r.status === 400) return { kind: 'gone' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}
