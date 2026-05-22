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

import { shannon, type SensitiveKind, type SensitiveMatch } from '@spool-lab/redact'

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

/** Confidence floor for ANY PF emission. Below this the model is
 *  effectively guessing — empirically ~40% of low-conf matches on
 *  Spool's dev DB were obvious junk ("bgvnljn80" 0.36, "toolu_01..."
 *  0.38, "id" 0.5). The model's own published F1 is on natural-language
 *  PII benchmarks; our dev session text (mixed Chinese + code + tool
 *  IDs + hashes) is well out of distribution. */
const PF_MIN_CONFIDENCE = 0.85

export function mapPfMatch(
  pf: PfRawMatch,
  ctx: MappingContext,
): SensitiveMatch | null {
  // Universal confidence floor — applied before any per-class logic
  // so noise gets dropped regardless of suppression rules.
  if (pf.score < PF_MIN_CONFIDENCE) return null
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
  // Restricted to PF categories where the model's published precision
  // is meaningfully above regex's already-strong patterns:
  //   email  (P=0.97 even without contextual clues)
  //   phone  (P=0.92, catches digit-word + spacing variants regex misses)
  //   date   (P=1.00 — but only paired with a DOB context)
  //   secret (P=1.00 — standalone allowed with confidence/entropy/
  //          length safety net; this is where ML *can* meaningfully
  //          beat regex on novel custom-token formats)
  // We DROP person / address / url / account_number entirely. On the
  // model card's "PII only" (no clue) numbers — which is Spool's
  // actual setting — those four sit at P=0.62-0.82, i.e. 18-38% false
  // positives. On out-of-distribution technical content (hashes /
  // tool ids / split URLs) the card shows precision crashing further
  // (line_breaks 0.45, phonetic 0.27). Regex doesn't cover these
  // kinds either, so we accept the recall gap — coverage we can't
  // trust isn't coverage.
  switch (pf.class) {
    case 'email':
      return 'email'
    case 'phone':
      return 'phone'

    case 'date':
      // Dates by themselves are noisy. Only emit when the +/- 32
      // chars around the match look like a DOB context.
      return looksLikeDob(pf, ctx.fullText) ? 'date-of-birth' : null

    case 'secret':
      // Layered safety net because Spool content has plenty of
      // commit SHAs / hex hashes / vendor tokens that look secret-
      // shaped to the model:
      //   1) regex-overlap → trust regex (already credential-shaped)
      //   2) confidence ≥ 0.95 (model card P=1.00 in best case, but
      //      OOD content demands explicit high score)
      //   3) length ≥ 16 (real credentials are at least this)
      //   4) Shannon entropy ≥ 4.0 (real secrets are random; a
      //      placeholder like 'changemechangeme' clocks in lower)
      if (overlapsRegexKind(pf, ctx.regexMatches, 'generic-secret')) {
        return 'generic-secret'
      }
      if (pf.score < 0.95) return null
      if (pf.value.length < 16) return null
      if (shannon(pf.value) < 4.0) return null
      return 'generic-secret'

    case 'person':
    case 'address':
    case 'url':
    case 'account_number':
      // See block comment above — disabled until either a domain
      // fine-tune or a shipping shape filter that survives Spool's
      // technical content.
      return null

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
