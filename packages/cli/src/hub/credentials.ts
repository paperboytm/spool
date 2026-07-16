import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_HUB_URL = 'https://spool.pro'

export interface StoredHubCredentials {
  hubUrl: string
  token: string
}

export interface HubCredentials {
  hubUrl: string
  token?: string
}

export interface HubCredentialOptions {
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

export function hubCredentialsPath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, '.spool', 'hub-credentials.json')
}

export function loadHubCredentials(options: HubCredentialOptions = {}): HubCredentials {
  const path = hubCredentialsPath(options)
  const env = options.env ?? process.env
  const envHubUrl = nonEmpty(env['SPOOL_HUB_URL'])
  const envToken = nonEmpty(env['SPOOL_HUB_TOKEN'])
  const stored = envHubUrl !== undefined && envToken !== undefined
    ? undefined
    : readStoredCredentialObject(path)

  const hubUrl = normalizeHubUrl(
    envHubUrl
    ?? (stored?.['hubUrl'] === undefined
      ? DEFAULT_HUB_URL
      : requireNonEmpty(stored['hubUrl'], 'hubUrl')),
  )
  const token = envToken
    ?? (stored?.['token'] === undefined
      ? undefined
      : requireNonEmpty(stored['token'], 'token'))

  return token === undefined ? { hubUrl } : { hubUrl, token }
}

export function saveHubCredentials(
  credentials: StoredHubCredentials,
  options: HubCredentialOptions = {},
): string {
  const path = hubCredentialsPath(options)
  const stored: StoredHubCredentials = {
    hubUrl: normalizeHubUrl(credentials.hubUrl),
    token: requireNonEmpty(credentials.token, 'Hub token'),
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(path, 0o600)
  return path
}

function readStoredCredentialObject(path: string): Record<string, unknown> | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error('expected a JSON object')
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid hub credentials at ${path}: ${message}`)
  }
}

function normalizeHubUrl(value: string): string {
  const normalized = requireNonEmpty(value, 'Hub URL').replace(/\/+$/, '')
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('must use http or https')
    }
    return normalized
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid Hub URL: ${message}`)
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error
}
