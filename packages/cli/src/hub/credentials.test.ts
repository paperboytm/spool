import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_HUB_URL,
  hubCredentialsPath,
  loadHubCredentials,
  saveHubCredentials,
} from './credentials.js'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'spool-hub-credentials-'))
  homes.push(home)
  return home
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('hub credentials', () => {
  it('round-trips credentials under a temporary HOME', () => {
    const home = tempHome()
    vi.stubEnv('HOME', home)
    vi.stubEnv('SPOOL_HUB_URL', '')
    vi.stubEnv('SPOOL_HUB_TOKEN', '')

    const savedPath = saveHubCredentials({
      hubUrl: 'https://hub.example',
      token: 'secret-token',
    })

    expect(savedPath).toBe(join(home, '.spool', 'hub-credentials.json'))
    expect(loadHubCredentials()).toEqual({
      hubUrl: 'https://hub.example',
      token: 'secret-token',
    })
    expect(JSON.parse(readFileSync(savedPath, 'utf8'))).toEqual({
      hubUrl: 'https://hub.example',
      token: 'secret-token',
    })
  })

  it('applies URL and token environment overrides independently', () => {
    const home = tempHome()
    saveHubCredentials(
      { hubUrl: 'https://stored.example', token: 'stored-token' },
      { homeDir: home },
    )

    expect(loadHubCredentials({
      homeDir: home,
      env: { SPOOL_HUB_URL: 'http://127.0.0.1:8788' },
    })).toEqual({
      hubUrl: 'http://127.0.0.1:8788',
      token: 'stored-token',
    })
    expect(loadHubCredentials({
      homeDir: home,
      env: { SPOOL_HUB_TOKEN: 'environment-token' },
    })).toEqual({
      hubUrl: 'https://stored.example',
      token: 'environment-token',
    })
  })

  it('uses the production hub URL when no credentials exist', () => {
    const home = tempHome()

    expect(hubCredentialsPath({ homeDir: home })).toBe(
      join(home, '.spool', 'hub-credentials.json'),
    )
    expect(loadHubCredentials({ homeDir: home, env: {} })).toEqual({
      hubUrl: DEFAULT_HUB_URL,
    })
  })

  it('uses complete environment overrides without reading corrupt disk credentials', () => {
    const home = tempHome()
    const path = hubCredentialsPath({ homeDir: home })
    mkdirSync(join(home, '.spool'), { recursive: true })
    writeFileSync(path, 'not json', 'utf8')

    expect(loadHubCredentials({
      homeDir: home,
      env: {
        SPOOL_HUB_URL: 'http://127.0.0.1:8788',
        SPOOL_HUB_TOKEN: 'environment-token',
      },
    })).toEqual({
      hubUrl: 'http://127.0.0.1:8788',
      token: 'environment-token',
    })
  })
})
