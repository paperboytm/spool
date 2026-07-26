import { bytesToHex, sha256 } from './crypto.js'
import type { CanonicalizeOptions, CanonicalRecord, JsonValue } from './types.js'

const textEncoder = new TextEncoder()
const WORKSPACE_TOKEN = '$SPOOL_WS'
const HOME_TOKEN = '$SPOOL_HOME'
export const PORTABLE_SESSION_BACKUP_VERSION = 1

export interface PortableSessionBackupV1 extends CanonicalRecord {
  version: typeof PORTABLE_SESSION_BACKUP_VERSION
}

export function splitRecords(jsonl: string): string[] {
  return jsonl
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.trim().length > 0)
}

export async function canonicalizeRecord(
  rawLine: string,
  options: CanonicalizeOptions = {},
): Promise<CanonicalRecord> {
  const parsed = JSON.parse(rawLine) as JsonValue
  let data = serializeCanonical(parsed)
  data = rewriteOccurrence(data, options.workspaceRoot, WORKSPACE_TOKEN)
  data = rewriteOccurrence(data, options.homeDir, HOME_TOKEN)

  const oid = bytesToHex(await sha256(textEncoder.encode(data)))
  return { oid, data }
}

/**
 * Preserve one provider JSONL record as a content-addressed portable backup.
 * `data` remains direct provider JSON for rolling compatibility; only decoded
 * local path strings are tokenized.
 */
export async function backupSessionRecord(
  rawLine: string,
  options: CanonicalizeOptions = {},
): Promise<PortableSessionBackupV1> {
  const parsed = JSON.parse(rawLine) as JsonValue
  assertJsonStrings(parsed)
  assertRootDoesNotCollide(options.workspaceRoot)
  assertRootDoesNotCollide(options.homeDir)
  const data = rewriteJsonStringTokens(rawLine, (value) =>
    makeStringPortable(value, options.workspaceRoot, options.homeDir),
  )

  const oid = bytesToHex(await sha256(textEncoder.encode(data)))
  return { version: PORTABLE_SESSION_BACKUP_VERSION, oid, data }
}

/** Return provider bytes from either a raw string or a content-addressed record. */
export function sessionRecordData(record: string | { data: string }): string {
  return typeof record === 'string' ? record : record.data
}

/** Restore path tokens without parse/stringifying unrelated provider bytes. */
export function restoreSessionRecord(data: string, workspaceRoot: string, homeDir: string): string {
  return rewriteJsonStringTokens(data, (value) =>
    value.split(WORKSPACE_TOKEN).join(workspaceRoot).split(HOME_TOKEN).join(homeDir),
  )
}

function serializeCanonical(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonical(item)).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys
    .map((key) => {
      assertUnicodeScalarString(key)
      return `${JSON.stringify(key)}:${serializeCanonical(value[key] as JsonValue)}`
    })
    .join(',')}}`
}

function makeStringPortable(
  value: string,
  workspaceRoot: string | undefined,
  homeDir: string | undefined,
): string {
  let portable = value
  if (workspaceRoot) portable = portable.split(workspaceRoot).join(WORKSPACE_TOKEN)
  if (homeDir) portable = portable.split(homeDir).join(HOME_TOKEN)
  return portable
}

function rewriteJsonStringTokens(data: string, transform: (value: string) => string): string {
  let output = ''
  let unchangedFrom = 0
  let index = 0
  while (index < data.length) {
    if (data[index] !== '"') {
      index += 1
      continue
    }
    const start = index
    index += 1
    while (index < data.length) {
      if (data[index] === '\\') {
        index += 2
        continue
      }
      if (data[index] === '"') {
        index += 1
        break
      }
      index += 1
    }
    const token = data.slice(start, index)
    const value = JSON.parse(token) as string
    // Validate every raw token, including values hidden by duplicate object
    // keys after JSON.parse has built the object.
    assertUnicodeScalarString(value)
    const rewritten = transform(value)
    if (rewritten === value) continue
    output += data.slice(unchangedFrom, start)
    output += JSON.stringify(rewritten)
    unchangedFrom = index
  }
  return unchangedFrom === 0 ? data : output + data.slice(unchangedFrom)
}

function assertRootDoesNotCollide(root: string | undefined): void {
  if (root?.includes(WORKSPACE_TOKEN) || root?.includes(HOME_TOKEN)) {
    throw new TypeError('Local paths cannot contain reserved Spool portability tokens')
  }
}

function assertJsonStrings(value: JsonValue): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonStrings(item)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    assertUnicodeScalarString(key)
    assertJsonStrings(child)
  }
}

function rewriteOccurrence(
  data: string,
  original: string | undefined,
  replacement: string,
): string {
  if (!original) return data
  assertUnicodeScalarString(original)
  const escaped = JSON.stringify(original).slice(1, -1)
  return data.split(escaped).join(replacement)
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new TypeError('JCS strings cannot contain lone surrogates')
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('JCS strings cannot contain lone surrogates')
    }
  }
}
