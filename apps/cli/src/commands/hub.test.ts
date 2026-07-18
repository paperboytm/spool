import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { saveHubCredentials } from '../hub/credentials.js'
import { handleLoginCommand } from './login.js'
import { handleLogoutCommand } from './logout.js'
import { handleWithdrawCommand } from './withdraw.js'

const SID = 'claude_11111111-2222-4333-8444-555555555555'
const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'spool-hub-command-'))
  homes.push(home)
  return home
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('login command handler', () => {
  it('saves a --token value and reports the credential path without a round-trip', async () => {
    const home = tempHome()
    const output: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(
      handleLoginCommand(
        { token: 'pasted-token' },
        {
          homeDir: home,
          env: { SPOOL_HUB_URL: 'http://127.0.0.1:8788' },
          log: (message) => output.push(message),
        },
      ),
    ).resolves.toBe(0)

    const path = join(home, '.spool', 'hub-credentials.json')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      hubUrl: 'http://127.0.0.1:8788',
      token: 'pasted-token',
    })
    expect(output).toEqual([`Signed in. Credentials saved to ${path}.`])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('runs the browser approval flow when the flag is omitted', async () => {
    const home = tempHome()
    const output: string[] = []
    const opened: string[] = []
    let polls = 0

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/cli-auth/start')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-secret',
            user_code: 'XKCD-2941',
            verification_uri: 'https://spool.pro/cli-auth?code=XKCD-2941',
            expires_in: 900,
            interval: 3,
          }),
          { status: 200 },
        )
      }
      if (url.endsWith('/api/cli-auth/poll')) {
        polls += 1
        return polls < 3
          ? new Response(JSON.stringify({ status: 'pending', interval: 3 }), { status: 200 })
          : new Response(JSON.stringify({ status: 'approved', token: 'sph_browser' }), {
              status: 200,
            })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    await expect(
      handleLoginCommand(
        {},
        {
          homeDir: home,
          env: {},
          fetchImpl: fetchMock as unknown as typeof fetch,
          openBrowser: async (url) => {
            opened.push(url)
            return true
          },
          sleep: async () => undefined,
          label: 'testbox',
          log: (message) => output.push(message),
        },
      ),
    ).resolves.toBe(0)

    expect(JSON.parse(readFileSync(join(home, '.spool', 'hub-credentials.json'), 'utf8'))).toEqual({
      hubUrl: 'https://spool.pro',
      token: 'sph_browser',
    })
    expect(opened).toEqual(['https://spool.pro/cli-auth?code=XKCD-2941'])
    expect(output[0]).toContain('XKCD-2941')
    // The start call carries the approval-page label.
    const startCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/cli-auth/start'))!
    const startInit = startCall[1] as RequestInit
    expect(JSON.parse(String(startInit.body))).toEqual({ label: 'testbox' })
  })

  it('reports a denied / expired request as a failure', async () => {
    const home = tempHome()
    const errors: string[] = []

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/cli-auth/start')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-secret',
            user_code: 'XKCD-2941',
            verification_uri: 'https://spool.pro/cli-auth?code=XKCD-2941',
            expires_in: 900,
            interval: 3,
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ error: 'NOT_FOUND', detail: 'expired or denied' }), {
        status: 404,
      })
    })

    await expect(
      handleLoginCommand(
        {},
        {
          homeDir: home,
          env: {},
          fetchImpl: fetchMock as unknown as typeof fetch,
          openBrowser: async () => true,
          sleep: async () => undefined,
          label: 'testbox',
          log: () => undefined,
          error: (message) => errors.push(message),
        },
      ),
    ).resolves.toBe(1)

    expect(errors.join('\n')).toMatch(/expired or was denied/)
    expect(existsSync(join(home, '.spool', 'hub-credentials.json'))).toBe(false)
  })

  it('times out when nobody approves before the deadline', async () => {
    const home = tempHome()
    const errors: string[] = []

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/cli-auth/start')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-secret',
            user_code: 'XKCD-2941',
            verification_uri: 'https://spool.pro/cli-auth?code=XKCD-2941',
            expires_in: 0, // deadline already passed → zero poll iterations
            interval: 3,
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    await expect(
      handleLoginCommand(
        {},
        {
          homeDir: home,
          env: {},
          fetchImpl: fetchMock as unknown as typeof fetch,
          openBrowser: async () => false,
          sleep: async () => undefined,
          label: 'testbox',
          log: () => undefined,
          error: (message) => errors.push(message),
        },
      ),
    ).resolves.toBe(1)

    expect(errors.join('\n')).toMatch(/timed out waiting for browser approval/)
  })
})

describe('logout command handler', () => {
  it('revokes the hub token and deletes the credentials file', async () => {
    const home = tempHome()
    saveHubCredentials(
      { hubUrl: 'https://stored.example', token: 'sph_machine' },
      { homeDir: home },
    )
    const output: string[] = []
    const errors: string[] = []
    const fetchMock = vi.fn(async () => Response.json({ revoked: true }))

    await expect(
      handleLogoutCommand({
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).resolves.toBe(0)

    const [input, init] = fetchMock.mock.calls[0]! as [string | URL | Request, RequestInit]
    expect(String(input)).toBe('https://stored.example/api/hub/v1/tokens')
    expect(init.method).toBe('DELETE')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sph_machine')
    const path = join(home, '.spool', 'hub-credentials.json')
    expect(existsSync(path)).toBe(false)
    expect(output.join('\n')).toContain('Revoked the token on https://stored.example')
    expect(output.join('\n')).toContain(`Removed local credentials at ${path}`)
    expect(output.at(-1)).toBe('Signed out.')
    expect(errors).toEqual([])
  })

  it('still signs out locally when the hub is unreachable', async () => {
    const home = tempHome()
    saveHubCredentials(
      { hubUrl: 'https://stored.example', token: 'sph_machine' },
      { homeDir: home },
    )
    const output: string[] = []
    const errors: string[] = []
    const fetchMock = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })

    await expect(
      handleLogoutCommand({
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).resolves.toBe(0)

    expect(existsSync(join(home, '.spool', 'hub-credentials.json'))).toBe(false)
    expect(errors.join('\n')).toMatch(/Could not revoke the remote token/)
    expect(output.join('\n')).toMatch(/Removed local credentials at /)
  })

  it('treats an already-invalid token as signed out', async () => {
    const home = tempHome()
    saveHubCredentials({ hubUrl: 'https://stored.example', token: 'sph_stale' }, { homeDir: home })
    const output: string[] = []
    const errors: string[] = []
    const fetchMock = vi.fn(async () =>
      Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 }),
    )

    await expect(
      handleLogoutCommand({
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).resolves.toBe(0)

    expect(existsSync(join(home, '.spool', 'hub-credentials.json'))).toBe(false)
    expect(output.join('\n')).toMatch(/already invalidated/)
    expect(errors).toEqual([])
  })

  it('fails when not logged in and makes no request', async () => {
    const home = tempHome()
    const errors: string[] = []
    const fetchMock = vi.fn()

    await expect(
      handleLogoutCommand({
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).resolves.toBe(1)

    expect(errors.join('\n')).toMatch(/Not logged in/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('points out a lingering SPOOL_HUB_TOKEN env override', async () => {
    const home = tempHome()
    saveHubCredentials(
      { hubUrl: 'https://stored.example', token: 'sph_machine' },
      { homeDir: home },
    )
    const output: string[] = []
    const fetchMock = vi.fn(async () => Response.json({ revoked: true }))

    await expect(
      handleLogoutCommand({
        homeDir: home,
        env: { SPOOL_HUB_TOKEN: 'sph_env' },
        fetch: fetchMock as typeof fetch,
        log: (message) => output.push(message),
        error: () => undefined,
      }),
    ).resolves.toBe(0)

    // The stored token is the one revoked — never the env override.
    const [, init] = fetchMock.mock.calls[0]! as [string | URL | Request, RequestInit]
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sph_machine')
    expect(output.join('\n')).toMatch(/SPOOL_HUB_TOKEN is still set/)
  })
})

describe('withdraw command handler', () => {
  it('resolves a share URL, POSTs withdraw, and prints confirmation', async () => {
    const home = tempHome()
    saveHubCredentials(
      { hubUrl: 'https://stored.example', token: 'owner-token' },
      { homeDir: home },
    )
    const output: string[] = []
    const errors: string[] = []
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))

    await expect(
      handleWithdrawCommand(`https://shared.example/session/${SID}`, {
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).resolves.toBe(0)

    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe(`https://shared.example/api/hub/v1/sessions/${SID}/withdraw`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-token')
    expect(output.join('\n')).toContain(`Withdrew session ${SID}.`)
    expect(errors).toEqual([])
  })

  it.each([
    [401, 'Authentication failed. Run `spool login` to update your hub token.'],
    [404, `Session not found: ${SID}`],
    [410, `Session already withdrawn: ${SID}`],
  ])('prints a friendly HTTP %s error', async (status, expected) => {
    const home = tempHome()
    saveHubCredentials({ hubUrl: 'https://spool.pro', token: 'owner-token' }, { homeDir: home })
    const errors: string[] = []
    const fetchMock = vi.fn(async () => Response.json({ message: 'server detail' }, { status }))

    await expect(
      handleWithdrawCommand(SID, {
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).resolves.toBe(1)

    expect(errors.at(-1)).toBe(expected)
  })
})
