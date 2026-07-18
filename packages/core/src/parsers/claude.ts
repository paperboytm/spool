import { readFileSync } from 'node:fs'

import { parseClaudeSessionText } from '@spool-lab/session-kit'

import type { ParseSessionResult, ParsedSession } from '../types.js'

// The parsing brain lives in @spool-lab/session-kit (browser-safe, shared
// with the web reader); this wrapper owns only the file I/O.

export function loadClaudeSession(filePath: string): ParseSessionResult {
  return parseClaudeSessionText(readFileSync(filePath, 'utf8'), filePath)
}

export function parseClaudeSession(filePath: string): ParsedSession | null {
  try {
    const result = loadClaudeSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

/** Decode a Claude project slug to a display path.
 *  e.g. '-Users-claw-code-spool' → '/Users/claw/code/spool'
 *  Note: lossy for paths containing hyphens — prefer cwd from session records.
 */
export function decodeProjectSlug(slug: string): string {
  if (!slug.startsWith('-')) return slug
  return '/' + slug.slice(1).replace(/-/g, '/')
}
