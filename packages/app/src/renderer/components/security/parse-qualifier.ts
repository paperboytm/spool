// GitHub-style qualifier parser for the Security page filter bar.
//
// Grammar (pragmatic — tolerant of mixed order, whitespace, and
// stray tokens):
//   `kind:<SensitiveKind>      severity:high|low      is:active|dismissed|purged
//    session:<uuid-prefix>     <free text>`
//
// Unknown qualifiers are ignored (not errored) so the user can paste
// half-formed queries without UX punishing them; the test suite
// pins the happy paths.

import type { SensitiveKind } from '@spool-lab/redact'
import type { FindingState, SessionFindingFilter } from '@spool-lab/core'

export interface ParsedQualifier {
  filter: SessionFindingFilter
  sessionUuid?: string
  /** Free-form text not bound to any qualifier — usually a title fragment. */
  text: string
}

const KNOWN_STATES: ReadonlySet<FindingState | 'any'> = new Set(['active', 'dismissed', 'purged', 'any'])
const KNOWN_SEVERITIES: ReadonlySet<'high' | 'low'> = new Set(['high', 'low'])

export function parseQualifier(input: string): ParsedQualifier {
  const out: ParsedQualifier = { filter: {}, text: '' }
  if (!input.trim()) return out

  const remainder: string[] = []
  // Split on whitespace; preserve order. Each token either is a
  // `name:value` qualifier (lowercase name) or free text.
  for (const tokenRaw of input.split(/\s+/)) {
    const token = tokenRaw.trim()
    if (!token) continue
    const colonIdx = token.indexOf(':')
    if (colonIdx <= 0 || colonIdx === token.length - 1) {
      remainder.push(token)
      continue
    }
    const name = token.slice(0, colonIdx).toLowerCase()
    const value = token.slice(colonIdx + 1)
    switch (name) {
      case 'kind':
        out.filter.kind = value as SensitiveKind
        break
      case 'is':
        if (KNOWN_STATES.has(value as FindingState | 'any')) {
          out.filter.state = value as FindingState | 'any'
        } else {
          remainder.push(token)
        }
        break
      case 'severity':
        if (KNOWN_SEVERITIES.has(value as 'high' | 'low')) {
          out.filter.severity = value as 'high' | 'low'
        } else {
          remainder.push(token)
        }
        break
      case 'session':
        out.sessionUuid = value
        break
      default:
        remainder.push(token)
    }
  }
  out.text = remainder.join(' ')
  if (out.text) out.filter.text = out.text
  return out
}

/** Reverse — rebuild a qualifier string. Useful when a UI click fills
 *  the bar (e.g. clicking the Risk panel "api-key" chip sets
 *  `kind:api-key`). Existing qualifiers are preserved; the new one
 *  replaces or adds. */
export function withQualifier(
  current: string,
  name: 'kind' | 'is' | 'severity' | 'session',
  value: string,
): string {
  const rx = new RegExp(`(^|\\s)${name}:[^\\s]+`, 'g')
  const stripped = current.replace(rx, '').trim()
  return `${name}:${value}${stripped ? ` ${stripped}` : ''}`
}
