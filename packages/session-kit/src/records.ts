import { bytesToHex, sha256 } from './crypto.js'
import type { CanonicalizeOptions, CanonicalRecord, JsonValue } from './types.js'

const textEncoder = new TextEncoder()

export function splitRecords(jsonl: string): string[] {
  return jsonl
    .split('\n')
    .map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
    .filter(line => line.trim().length > 0)
}

export async function canonicalizeRecord(
  rawLine: string,
  options: CanonicalizeOptions = {},
): Promise<CanonicalRecord> {
  const parsed = JSON.parse(rawLine) as JsonValue
  let data = serializeCanonical(parsed)

  data = rewriteOccurrence(data, options.workspaceRoot, '$SPOOL_WS')
  data = rewriteOccurrence(data, options.homeDir, '$SPOOL_HOME')

  const oid = bytesToHex(await sha256(textEncoder.encode(data)))
  return { oid, data }
}

function serializeCanonical(value: JsonValue): string {
  if (value === null) return 'null'

  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }

  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => serializeCanonical(item)).join(',')}]`
  }

  const keys = Object.keys(value).sort()
  return `{${keys.map(key => {
    assertUnicodeScalarString(key)
    return `${JSON.stringify(key)}:${serializeCanonical(value[key] as JsonValue)}`
  }).join(',')}}`
}

function rewriteOccurrence(data: string, original: string | undefined, replacement: string): string {
  if (!original) return data
  assertUnicodeScalarString(original)

  const serialized = JSON.stringify(original)
  const escaped = serialized.slice(1, -1)
  return data.split(escaped).join(replacement)
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) throw new TypeError('JCS strings cannot contain lone surrogates')
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('JCS strings cannot contain lone surrogates')
    }
  }
}
