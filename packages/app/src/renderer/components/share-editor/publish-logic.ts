// Pure functions for the publish modal — extracted so unit tests can
// exercise the PII gate without standing up React. The modal is the
// only consumer.

import {
  detectSensitiveSpans,
  hashValueForRedactExclude,
  SENSITIVE_KIND_LABEL,
  type SensitiveKind,
} from '@spool-lab/redact'
import type { Conversation, EditorOpts } from '@spool/share-kit'

export interface UnredactedMatch {
  turn_index: number
  kind: SensitiveKind
  /** Display label for the kind, sourced from `@spool-lab/redact`. */
  label: string
  /** Truncated literal — max 16 chars + ellipsis. Never the full value. */
  preview: string
  start: number
  end: number
}

export interface TieredMatches {
  high: UnredactedMatch[]
  medium: UnredactedMatch[]
}

/** Kinds that block publish — leaking any of these is potentially
 *  catastrophic (live credentials, financial / identity numbers).
 *  Defined as a string set so this file stays decoupled from
 *  `@spool-lab/redact`'s internal kind enum ordering.
 *  `env-var` is in this list because env-var values are routinely
 *  live credentials (STRIPE_KEY=sk_live_..., DATABASE_URL=postgres://...)
 *  — the `NAME=` prefix is what's detected, the value is what leaks. */
const HIGH_RISK_KINDS = new Set<SensitiveKind>([
  'api-key',
  'jwt',
  'private-key',
  'ssh-key',
  'cloud-cred-ini',
  'bearer',
  'basic-auth',
  'generic-secret',
  'connection-string',
  'url-creds',
  'credit-card',
  'ssn',
  'kubeconfig-token',
  'netrc',
  'env-var',
])

const PREVIEW_MAX = 16

export function truncatePreview(value: string): string {
  if (value.length <= PREVIEW_MAX) return value
  return value.slice(0, PREVIEW_MAX) + '…'
}

/**
 * Run the sensitive-span detector across every visible turn of the
 * RAW conversation, filter out anything the current redact policy
 * would cover, then split the survivors into high-risk (blocks
 * publish) and medium-risk (warn only) tiers.
 *
 * Runs on the raw conversation, not the post-redact snapshot — that's
 * the only way the modal can tell which matches are about to slip
 * through (because the user disabled redact entirely, opted a kind
 * out via `redactExclude.kinds`, or kept a specific literal via
 * `redactExclude.valueHashes`).
 */
export function computeUnredactedMatches(
  conversation: Conversation,
  opts: EditorOpts,
): TieredMatches {
  const exclude = opts.redactExclude
  const excludeKinds = new Set(exclude?.kinds ?? [])
  const excludeHashes = new Set(exclude?.valueHashes ?? [])
  const excludeValues = new Set(exclude?.values ?? [])
  const policyCovers = (m: { kind: SensitiveKind; value: string }): boolean => {
    if (!opts.redact) return false
    if (excludeKinds.has(m.kind)) return false
    if (excludeValues.has(m.value)) return false
    if (excludeHashes.size > 0 && excludeHashes.has(hashValueForRedactExclude(m.value))) {
      return false
    }
    return true
  }
  // Hidden turns aren't published — `buildSnapshotFromEditor` blanks
  // their bodies before upload — so any sensitive matches inside them
  // are moot. Skip them here too, otherwise the gate fires on data
  // that will never reach R2 and the warning copy lies to the user.
  const selected = opts.selected
  const isHidden = (idx: number): boolean =>
    selected !== undefined && !selected.includes(idx)
  const high: UnredactedMatch[] = []
  const medium: UnredactedMatch[] = []
  conversation.turns.forEach((turn, idx) => {
    if (isHidden(idx)) return
    const matches = detectSensitiveSpans(turn.body)
    if (matches.length === 0) return
    for (const m of matches) {
      if (policyCovers(m)) continue
      const entry: UnredactedMatch = {
        turn_index: idx,
        kind: m.kind,
        label: SENSITIVE_KIND_LABEL[m.kind],
        preview: truncatePreview(turn.body.slice(m.start, m.end)),
        start: m.start,
        end: m.end,
      }
      if (HIGH_RISK_KINDS.has(m.kind)) high.push(entry)
      else medium.push(entry)
    }
  })
  return { high, medium }
}

export type ExpiryOption = 'never' | '7d' | '30d' | '90d'

const DAY_MS = 86_400_000

/**
 * Resolve a fixed expiry preset to the absolute ISO timestamp the
 * backend expects, or undefined for "never". `now` is injectable for
 * deterministic tests.
 *
 * No custom date picker: GitHub gists, Notion, Linear, Figma, Google
 * Docs, Slack offer no expiry at all (revoke only); Dropbox, Loom,
 * Vercel use fixed presets. None offer arbitrary datetimes for
 * share-link expiry. If product wants more granularity later, switch
 * to a date-only picker — never a datetime-local.
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
    case '90d':
      return new Date(now + 90 * DAY_MS).toISOString()
  }
}
