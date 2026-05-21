// Privacy Filter class mapping.
//
// openai/privacy-filter emits 8 entity-group categories after the
// constrained Viterbi decoder collapses BIOES tags:
//
//   private_person / private_email / private_phone / private_address /
//   private_url / private_date / account_number / secret
//
// pf-inference.ts strips the `private_` prefix before sending the
// match to this module, so the class strings handled here are the
// short forms ('person', 'email', 'phone', 'address', 'url', 'date',
// 'account_number', 'secret').
//
// Some classes need suppression rules so the ML model doesn't
// out-shout the regex detector for things the regex already covers
// with checksums or vendor-prefix tokens. Spec:
// ~/Documents/dev-docs/spool/2026-05-18-security-scan-design.md
// §"Class mapping".

import type { SensitiveKind, SensitiveMatch } from '@spool-lab/redact'

/** Short-form class label emitted by pf-inference.ts after the
 *  `private_` prefix is stripped. */
export type PfClass =
  | 'person'
  | 'email'
  | 'phone'
  | 'url'
  | 'address'
  | 'date'
  | 'account_number'
  | 'secret'
  // Allow string so unknown labels from future model bumps fall
  // through to the default suppression in mapClass().
  | string

export interface PfRawMatch {
  class: PfClass
  value: string
  start: number
  end: number
  /** Viterbi-decoded confidence, 0–1. */
  score: number
}

export interface MappingContext {
  /** Matches already produced by the regex provider for the same
   *  text. Used by url/secret rules — pf only emits when regex also
   *  flagged the same span, so the pf hit acts as a confidence
   *  boost rather than a noisy standalone signal. */
  regexMatches: ReadonlyArray<SensitiveMatch>
  /** Substring around each match used for DOB context gating. */
  fullText: string
}

const DOB_CONTEXT_RX = /\b(dob|date\s+of\s+birth|born\s+on|birthday|d\.?o\.?b\.?)\b/i

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
      // URLs aren't secrets on their own. Only emit when the regex
      // also saw url-creds in the same span — pf then acts as a
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

    default:
      // Unknown label — log once in dev, drop in prod. Only fires on
      // model swaps that forgot to update this switch.
      if (process.env['NODE_ENV'] !== 'production') {
        console.warn('[pf class-mapping] unknown label:', pf.class)
      }
      return null
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
