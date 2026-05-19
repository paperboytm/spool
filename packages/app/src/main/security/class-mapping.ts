// Privacy Filter class mapping.
//
// OpenAI Privacy Filter emits 8 classes; we map them to Spool's
// SensitiveKind. Some classes need suppression rules to avoid the
// model out-shouting the regex detector for things the regex
// already covers with checksums.
//
// Spec: ~/Documents/dev-docs/spool/2026-05-18-security-scan-design.md
// §"Class mapping"

import type { SensitiveKind, SensitiveMatch } from '@spool-lab/redact'

/** Privacy Filter's published class labels. */
export type PfClass =
  | 'person'
  | 'email'
  | 'phone'
  | 'url'
  | 'address'
  | 'date'
  | 'account_number'
  | 'secret'

export interface PfRawMatch {
  class: PfClass
  value: string
  start: number
  end: number
  /** PF model logit-derived confidence, 0–1. */
  score: number
}

export interface MappingContext {
  /** Matches already produced by the regex provider for the same
   *  text. Used by url/secret rules — pf only emits when regex also
   *  flagged the same span, so the pf hit acts as a confidence
   *  boost rather than a noisy standalone signal. */
  regexMatches: ReadonlyArray<SensitiveMatch>
  /** Optional substring around each match (~16 chars on each side)
   *  used for date-of-birth context gating. Caller passes the full
   *  text — gating runs cheaply. */
  fullText: string
}

const DOB_CONTEXT_RX = /\b(dob|date\s+of\s+birth|born\s+on|birthday|d\.?o\.?b\.?)\b/i

/** Map one PF raw match to a SensitiveMatch, or null when the
 *  suppression rules say to drop it. */
export function mapPfMatch(
  pf: PfRawMatch,
  ctx: MappingContext,
): SensitiveMatch | null {
  const kind = mapClass(pf, ctx)
  if (!kind) return null
  return {
    kind,
    value: pf.value,
    start: pf.start,
    end: pf.end,
    confidence: pf.score,
    provider: 'pf',
  }
}

function mapClass(pf: PfRawMatch, ctx: MappingContext): SensitiveKind | null {
  switch (pf.class) {
    case 'person':
      return 'person-name'
    case 'email':
      return 'email'
    case 'phone':
      return 'phone'
    case 'address':
      return 'street-address'
    case 'url':
      // URLs are not secrets on their own. Only emit when the regex
      // already saw url-creds in the same span — pf then acts as a
      // confidence boost on the regex hit.
      return overlapsRegexKind(pf, ctx.regexMatches, 'url-creds') ? 'url-creds' : null
    case 'date':
      // Dates by themselves are noisy. Only emit when the +/- 32
      // chars around the match look like a DOB context.
      return looksLikeDob(pf, ctx.fullText) ? 'date-of-birth' : null
    case 'account_number':
      // Too noisy without a Luhn-style checksum. Regex's `credit-card`
      // already covers Luhn-valid hits; everything else is suppressed.
      return null
    case 'secret':
      // Regex is authoritative for known credential prefixes. PF's
      // `secret` only fires as a boost on existing regex hits.
      return overlapsRegexKind(pf, ctx.regexMatches, 'generic-secret') ? 'generic-secret' : null
  }
}

function overlapsRegexKind(
  pf: PfRawMatch,
  regexMatches: ReadonlyArray<SensitiveMatch>,
  kind: SensitiveKind,
): boolean {
  for (const m of regexMatches) {
    if (m.kind !== kind) continue
    if (pf.start < m.end && pf.end > m.start) return true
  }
  return false
}

function looksLikeDob(pf: PfRawMatch, text: string): boolean {
  const windowStart = Math.max(0, pf.start - 32)
  const windowEnd = Math.min(text.length, pf.end + 32)
  return DOB_CONTEXT_RX.test(text.slice(windowStart, windowEnd))
}

/** Bulk map — drop nulls. Convenience for the provider. */
export function mapPfMatches(
  pfMatches: ReadonlyArray<PfRawMatch>,
  ctx: MappingContext,
): SensitiveMatch[] {
  const out: SensitiveMatch[] = []
  for (const m of pfMatches) {
    const mapped = mapPfMatch(m, ctx)
    if (mapped) out.push(mapped)
  }
  return out
}
