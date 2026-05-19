// Pure functions for the publish modal — extracted so unit tests can
// exercise the PII gate without standing up React. The modal is the
// only consumer.

import { detectSensitiveSpans, SENSITIVE_KIND_LABEL } from '@spool-lab/redact'
import type { SensitiveKind } from '@spool-lab/redact'
import type { Snapshot } from '../../../shared/share-publish.js'

export interface UnredactedMatch {
  turn_id: string
  kind: SensitiveKind
  /** Display label for the kind, sourced from `@spool-lab/redact`. */
  label: string
  /** Truncated literal — max 16 chars + ellipsis. Never the full value. */
  preview: string
  start: number
  end: number
}

const PREVIEW_MAX = 16

export function truncatePreview(value: string): string {
  if (value.length <= PREVIEW_MAX) return value
  return value.slice(0, PREVIEW_MAX) + '…'
}

/**
 * Re-detect sensitive spans across every non-hidden turn and subtract
 * anything fully covered by an existing redaction span. Returned
 * matches are what the user still needs to redact before they can
 * publish.
 *
 * Mirrors `rescanForPii` in share-backend's publish handler so the
 * client-side gate doesn't surface different matches than the server's
 * fail-closed rescan would.
 */
export function computeUnredactedMatches(snapshot: Snapshot): UnredactedMatch[] {
  const hidden = new Set(snapshot.conversation.hidden_turns)
  const covered = new Map<string, Array<[number, number]>>()
  for (const r of snapshot.redactions) {
    const arr = covered.get(r.turn_id) ?? []
    arr.push(r.span)
    covered.set(r.turn_id, arr)
  }
  const out: UnredactedMatch[] = []
  for (const turn of snapshot.conversation.turns) {
    if (hidden.has(turn.id)) continue
    const matches = detectSensitiveSpans(turn.content)
    if (matches.length === 0) continue
    const ranges = covered.get(turn.id) ?? []
    for (const m of matches) {
      const isCovered = ranges.some(([a, b]) => a <= m.start && m.end <= b)
      if (isCovered) continue
      out.push({
        turn_id: turn.id,
        kind: m.kind,
        label: SENSITIVE_KIND_LABEL[m.kind],
        preview: truncatePreview(turn.content.slice(m.start, m.end)),
        start: m.start,
        end: m.end,
      })
    }
  }
  return out
}

export type ExpiryOption = 'never' | '7d' | '30d' | '90d'

const DAY_MS = 86_400_000

/**
 * Resolve a fixed expiry preset to the absolute ISO timestamp the
 * backend expects, or undefined for "never". `now` is injectable for
 * deterministic tests.
 */
export function computeExpiresAt(
  args: { kind: ExpiryOption },
  now: number = Date.now(),
): string | undefined {
  switch (args.kind) {
    case 'never':
      return undefined
    case '7d':
      return new Date(now + 7 * DAY_MS).toISOString()
    case '30d':
      return new Date(now + 30 * DAY_MS).toISOString()
    case 'custom': {
      const raw = args.custom ?? ''
      if (!raw) return undefined
      const t = Date.parse(raw)
      if (Number.isNaN(t)) return undefined
      return new Date(t).toISOString()
    }
  }
}
