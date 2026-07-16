import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { parseCodexSessionLines } from '@spool-lab/session-kit'
import type { ParseSessionResult, ParsedSession } from '../types.js'

// The parsing brain lives in @spool-lab/session-kit (browser-safe, shared
// with the web reader); this wrapper owns only the streamed file I/O.

export const CODEX_INDEX_VERSION = 'codex-v5-filter-internal-assessment-and-approval-session-search-fts'

const READ_CHUNK_SIZE = 1024 * 1024

export function loadCodexSession(filePath: string): ParseSessionResult {
  return parseCodexSessionLines(readNonEmptyLines(filePath), filePath)
}

function* readNonEmptyLines(filePath: string): Iterable<string> {
  const fd = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(READ_CHUNK_SIZE)
  const decoder = new StringDecoder('utf8')
  let pending = ''

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break

      pending += decoder.write(buffer.subarray(0, bytesRead))
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim().length > 0) yield line
      }
    }

    pending += decoder.end()
    if (pending.trim().length > 0) yield pending
  } finally {
    closeSync(fd)
  }
}

export function parseCodexSession(filePath: string): ParsedSession | null {
  try {
    const result = loadCodexSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}
