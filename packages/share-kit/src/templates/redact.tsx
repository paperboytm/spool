// Redact helpers.
//
// Detection runs in two strict layers:
//   1. `detectPII(turns)` — scan-only. Returns everything found,
//      regardless of policy. Used by the editor's Privacy panel so
//      the user can SEE the full picture before deciding what to
//      mask.
//   2. `applyRedactPolicy(detection, exclude)` — policy filter +
//      mask builder. Drops matches whose kind is in `exclude.kinds`
//      or whose value is excluded (literal or hashed); for the
//      survivors, attaches the per-kind replacement string
//      (`maskValueByKind`).
//
// `collectRedactList(turns, opts)` is the convenience composition.
// Returns `RedactReplacement[]` — each entry is the literal to find
// and the per-kind mask to substitute. The body renderer and the
// markdown / .spool exporters consume the same shape.

import type { EditorOpts, RedactExclude, Turn } from '@/lib/types'
import {
  detectSensitiveSpansCached,
  groupBySensitiveKind,
  hashValueForRedactExclude,
  maskValueByKind,
  type SensitiveGroup,
  type SensitiveMatch,
} from '@spool-lab/redact'

// Re-export so existing share-kit consumers keep their import path;
// the cache itself lives in @spool-lab/redact so non-React surfaces
// (publish gate, future CLI/scan callers) share the same hits.
export { detectSensitiveSpansCached }

/** Synthetic "kind" tags for non-regex sources that the Privacy
 *  panel still wants to surface as filterable rows. Keep these
 *  distinct from `SensitiveKind` strings so a future `SensitiveKind`
 *  rename can't collide. */
export const SYNTHETIC_KIND_AUTHOR = 'synthetic:author'
export const SYNTHETIC_KIND_MANUAL = 'synthetic:manual'

export interface RedactReplacement {
  /** The literal substring to find in the conversation body. */
  value: string
  /** The masked form to render in its place (per-kind). */
  replacement: string
}

export interface PIIDetection {
  /** All regex-detected matches with positional info, kind, and
   *  confidence. Multiple turns are concatenated for display but
   *  each match is still keyed off its literal value. */
  matches: SensitiveMatch[]
  /** Per-kind aggregation for the editor UI. */
  groups: SensitiveGroup[]
  /** Bracketed author names — separate channel because they come
   *  from turn metadata, not body text. */
  names: string[]
  /** Manual entries pre-populated by the host. */
  manual: string[]
  /** Flat unfiltered list (regex values + names + manual) used as
   *  the starting point for policy application. */
  all: string[]
}

// Detection goes through @spool-lab/redact's per-Turn cache: editor
// surfaces (templates, ControlPanel, autosave, snapshot build, publish
// gate) all hold the same Turn objects across a session, so a policy
// toggle re-aggregates cached matches instead of re-scanning every
// body with the full regex suite.
export function detectPII(turns: Turn[]): PIIDetection {
  const matches: SensitiveMatch[] = []
  for (const t of turns) {
    matches.push(...detectSensitiveSpansCached(t))
  }
  const names = Array.from(
    new Set(
      turns
        .map((t) => t.author?.replace(/^\[|\]$/g, '').trim())
        .filter((n): n is string => !!n && n.length > 1 && n.toLowerCase() !== 'you'),
    ),
  )
  const manual = Array.from(new Set(turns.flatMap((t) => t.redact ?? [])))
  const detected = matches.map((m) => m.value)
  const all = Array.from(new Set([...detected, ...names, ...manual]))
  return { matches, groups: groupBySensitiveKind(matches), names, manual, all }
}

/** Apply a `RedactExclude` policy to a `PIIDetection` and return
 *  the substitution list. Drops matches whose kind is excluded or
 *  whose value/hash is excluded; for the survivors, attaches the
 *  per-kind mask string. Authors and manual entries use the
 *  synthetic kinds (`synthetic:author` / `synthetic:manual`). */
export function applyRedactPolicy(
  detection: PIIDetection,
  exclude: RedactExclude | undefined,
): RedactReplacement[] {
  const excludeKinds = new Set(exclude?.kinds ?? [])
  const excludeValues = new Set(exclude?.values ?? [])
  const excludeHashes = new Set(exclude?.valueHashes ?? [])
  const isExcludedValue = (v: string): boolean =>
    excludeValues.has(v) || (excludeHashes.size > 0 && excludeHashes.has(hashValueForRedactExclude(v)))

  // Use a Map keyed by literal so duplicate matches (same value in
  // two turns, or the same value found as both a regex match AND a
  // manual entry) collapse to one replacement. The first-seen kind
  // wins — typically the more specific regex kind beats the
  // synthetic fallbacks.
  const out = new Map<string, RedactReplacement>()
  const push = (value: string, kind: string) => {
    if (out.has(value)) return
    out.set(value, { value, replacement: maskValueByKind(value, kind) })
  }

  for (const m of detection.matches) {
    if (excludeKinds.has(m.kind)) continue
    if (isExcludedValue(m.value)) continue
    push(m.value, m.kind)
  }
  if (!excludeKinds.has(SYNTHETIC_KIND_AUTHOR)) {
    for (const n of detection.names) {
      if (isExcludedValue(n)) continue
      push(n, SYNTHETIC_KIND_AUTHOR)
    }
  }
  if (!excludeKinds.has(SYNTHETIC_KIND_MANUAL)) {
    for (const v of detection.manual) {
      if (isExcludedValue(v)) continue
      push(v, SYNTHETIC_KIND_MANUAL)
    }
  }
  return Array.from(out.values())
}

/** Convenience composition — runs detection then policy. Used by
 *  every render path (templates, markdown export, .spool sanitiser)
 *  so all surfaces apply the same redactions in the same shape. */
export function collectRedactList(
  turns: Turn[],
  opts?: Pick<EditorOpts, 'redactExclude'>,
): RedactReplacement[] {
  return applyRedactPolicy(detectPII(turns), opts?.redactExclude)
}
