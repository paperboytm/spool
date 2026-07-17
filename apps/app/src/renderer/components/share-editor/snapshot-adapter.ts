// Bridge between the editor's in-memory `Conversation` / `EditorOpts`
// pair and the wire-format `Snapshot` the backend accepts. Applies the
// share-kit redact pipeline (same code path as `.spool` download +
// Security purge) so the bytes that leave the device are already
// redacted — the server never sees raw PII.

import {
  ensureTurnIds,
  redactConversation,
  type Conversation,
  type EditorOpts,
} from '@spool/share-kit'
import type { Snapshot } from '../../../shared/share-publish.js'

/** Normalise a possibly-human-formatted date string to ISO 8601.
 *  Accepts ISO inputs untouched and falls back to the current
 *  timestamp on unparseable input so publish never blocks on a stale
 *  upstream date format. */
function toIsoOrNow(input: string | undefined): string {
  if (!input) return new Date().toISOString()
  const t = Date.parse(input)
  if (Number.isNaN(t)) return new Date().toISOString()
  return new Date(t).toISOString()
}

/**
 * Build a `Snapshot` from the editor's current Conversation + opts.
 * Runs the shared redact pipeline first, so `turns[].content` is the
 * already-masked literal and `turns[].redacted` is set for turns the
 * pass actually changed.
 */
export function buildSnapshotFromEditor(args: {
  conversation: Conversation
  opts: EditorOpts
}): Snapshot {
  const { conversation: rawConv, opts } = args
  // Defensive: editor entry points should have already backfilled
  // ids on load (`readSpoolFile`, draft open, session import), but
  // guarantee it here so `perTurnRedacted` is meaningful.
  const convWithIds: Conversation = {
    ...rawConv,
    turns: ensureTurnIds(rawConv.turns),
  }
  const { conversation: redactedConv, perTurnRedacted } = redactConversation(
    convWithIds,
    opts,
  )

  const selected = opts.selected
  const hiddenTurnIds =
    !selected
      ? []
      : redactedConv.turns
          .map((t, idx) => ({ id: t.id!, idx }))
          .filter(({ idx }) => !selected.includes(idx))
          .map((t) => t.id)
  // Hidden turns survive in the `turns` array (the backend validates
  // `turn_order.length === turns.length`), but their bodies are
  // BLANKED before upload so the snapshot stored in R2 carries no
  // record of the content the author chose to exclude. Without this
  // step, hidden bodies still ride along on the wire — the Reader
  // hides them client-side, but a direct GET of the snapshot JSON
  // would leak them. Matches the user's mental model: "unchecked = not
  // published, full stop."
  const hiddenIdSet = new Set(hiddenTurnIds)

  // Turn ids coming off `ensureTurnIds` are an fnv1a32 hash of the turn
  // content. Emitting them on the wire would leak content-derived
  // fingerprints (reversible for known content classes) and, via
  // `hidden_turns`, enumerate exactly which turns the author excluded —
  // contradicting the blank-body guarantee above. Remap every id to an
  // OPAQUE POSITIONAL token (`t0`, `t1`, … by array index) before
  // emitting. The reader only uses ids for ordering and hidden lookup,
  // never for content, so positional ids are fully compatible.
  const opaqueIdFor = new Map(
    redactedConv.turns.map((t, idx) => [t.id!, `t${idx}`]),
  )

  const snapshotTurns = redactedConv.turns.map((t, idx) => {
    const originalId = t.id!
    const id = `t${idx}`
    const role = (t.role === 'user' || t.role === 'assistant'
      ? t.role
      : 'assistant') as 'user' | 'assistant'
    if (hiddenIdSet.has(originalId)) {
      return { id, role, content: '' }
    }
    return {
      id,
      role,
      content: t.body,
      ...(perTurnRedacted.has(originalId) ? { redacted: true as const } : {}),
    }
  })

  const hiddenOpaqueIds = hiddenTurnIds.map((id) => opaqueIdFor.get(id)!)

  return {
    schema_version: 1,
    source: {
      kind: rawConv.origin.kind === 'agent-session' ? 'spool-session' : 'imported-file',
      // Backend schema is `z.iso.datetime()` — must be an ISO 8601
      // string. `Conversation.createdAt` upstream is a human-readable
      // date ("June 2, 2026") produced by `formatCreatedAt` in
      // compose-from-session.ts; parse-and-reformat to ISO before
      // sending. Falls back to "now" if the upstream string isn't
      // recognisable — the server's only consumer is the reader's
      // masthead caption so a soft fallback beats blowing up publish.
      captured_at: toIsoOrNow(rawConv.createdAt),
    },
    conversation: {
      title: rawConv.title || 'Untitled',
      turns: snapshotTurns,
      turn_order: snapshotTurns.map((t) => t.id),
      hidden_turns: hiddenOpaqueIds,
    },
    editor_opts: {
      template: opts.template,
      paper: opts.paper,
      typeface: opts.typeface,
      colorway: opts.colorway,
      density: opts.density,
      masthead: opts.showMasthead,
      colophon: opts.showColophon,
      avatars: true,
      show_byline: false,
    },
  }
}
