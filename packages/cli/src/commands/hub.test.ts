import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleLoginCommand } from './login.js'
import { handleWithdrawCommand } from './withdraw.js'
import { saveHubCredentials } from '../hub/credentials.js'

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

    await expect(handleLoginCommand(
      { token: 'pasted-token' },
      {
        homeDir: home,
        env: { SPOOL_HUB_URL: 'http://127.0.0.1:8788' },
        log: message => output.push(message),
      },
    )).resolves.toBe(0)

    const path = join(home, '.spool', 'hub-credentials.json')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      hubUrl: 'http://127.0.0.1:8788',
      token: 'pasted-token',
    })
    expect(output).toEqual([`You saved hub credentials to ${path}.`])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('prompts for a token when the flag is omitted', async () => {
    const home = tempHome()

    await expect(handleLoginCommand(
      {},
      {
        homeDir: home,
        env: {},
        promptToken: async () => ' interactive-token\n',
        log: () => undefined,
      },
    )).resolves.toBe(0)

    expect(JSON.parse(readFileSync(
      join(home, '.spool', 'hub-credentials.json'),
      'utf8',
    ))).toEqual({
      hubUrl: 'https://spool.pro',
      token: 'interactive-token',
    })
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

    await expect(handleWithdrawCommand(
      `https://shared.example/session/${SID}`,
      {
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: message => output.push(message),
        error: message => errors.push(message),
      },
    )).resolves.toBe(0)

    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe(
      `https://shared.example/api/hub/v1/sessions/${SID}/withdraw`,
    )
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-token')
    expect(output).toEqual([`You withdrew session ${SID}.`])
    expect(errors).toEqual([])
  })

  it.each([
    [401, 'Authentication failed. Run `spool login` to update your hub token.'],
    [404, `Session not found: ${SID}`],
    [410, `Session already withdrawn: ${SID}`],
  ])('prints a friendly HTTP %s error', async (status, expected) => {
    const home = tempHome()
    saveHubCredentials(
      { hubUrl: 'https://spool.pro', token: 'owner-token' },
      { homeDir: home },
    )
    const errors: string[] = []
    const fetchMock = vi.fn(async () => Response.json({ message: 'server detail' }, { status }))

    await expect(handleWithdrawCommand(
      SID,
      {
        homeDir: home,
        env: {},
        fetch: fetchMock as typeof fetch,
        log: () => undefined,
        error: message => errors.push(message),
      },
    )).resolves.toBe(1)

    expect(errors).toEqual([expected])
  })
})
