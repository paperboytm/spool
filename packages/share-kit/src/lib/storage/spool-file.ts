// Tier 2 storage — the .spool file. A user-owned, portable JSON document
// that captures both the conversation and the current editor settings.
//
// Two distinct call sites:
//   • Autosave draft (IndexedDB) — keeps the RAW conversation so the
//     user can come back later and continue editing. Local-only.
//   • Download — produces a file the user might hand to someone else.
//     Pass `{ sanitize: true }` to bake the redactions into the body
//     so the recipient never sees the original credentials. When
//     sanitised, the file is round-trippable (still valid .spool) but
//     the original text is irrecoverable from the file alone.

import type { Conversation, EditorOpts, SpoolDocument, Turn } from '../types'
import { saveBlob } from '../export'
import { sanitizeFilename } from '../filename'
import { collectRedactList } from '@/templates/redact'

const MIME = 'application/spool+json'

export interface BuildSpoolOptions {
  /** When true, replace every redact-list literal in turn bodies
   *  and author labels with `[redacted]` before serialising. Default
   *  false — the autosave path wants the raw original so the user
   *  can keep editing. The download path passes true. */
  sanitize?: boolean
}

export function buildSpoolDocument(
  conversation: Conversation,
  opts: EditorOpts,
  options: BuildSpoolOptions = {},
): SpoolDocument {
  const willSanitize = options.sanitize && opts.redact
  const conv = willSanitize
    ? redactConversation(conversation, opts).conversation
    : conversation
  // When sanitising for download, drop `redactExclude` from the
  // embedded opts. The recipient already sees `[redacted]` markers
  // in the body — they don't need to know which categories or
  // specific items the source user opted out of. That metadata
  // would be pure leak (mild, but unnecessary).
  const exportedOpts = willSanitize && opts.redactExclude
    ? (() => {
        const { redactExclude: _drop, ...rest } = opts
        return rest as EditorOpts
      })()
    : opts
  return {
    version: 2,
    conversation: conv,
    opts: exportedOpts,
    exportedAt: new Date().toISOString(),
  }
}

/** Walk every turn and replace each detected sensitive literal with
 *  its per-kind mask. Operates on a structural clone — the source
 *  object is never mutated, so callers can re-use the conversation.
 *
 *  Returns the redacted conversation and the set of turn ids whose
 *  body actually changed (used by the publish path to mark
 *  `Snapshot.turns[].redacted: true`). Turns without a stable id are
 *  skipped from `perTurnRedacted` — callers that care should run
 *  `ensureTurnIds` first. */
export function redactConversation(
  conversation: Conversation,
  opts: EditorOpts,
): { conversation: Conversation; perTurnRedacted: Set<string> } {
  if (!opts.redact) {
    return { conversation, perTurnRedacted: new Set() }
  }
  const redactList = collectRedactList(conversation.turns, opts)
  if (redactList.length === 0) {
    return { conversation, perTurnRedacted: new Set() }
  }
  const replaceMap = new Map(redactList.map((r) => [r.value, r.replacement]))
  const rx = new RegExp(redactList.map((r) => escapeRx(r.value)).join('|'), 'g')
  const perTurnRedacted = new Set<string>()
  const turns = conversation.turns.map((t) => {
    const next = sanitizeTurn(t, rx, replaceMap)
    if (next.body !== t.body && t.id) perTurnRedacted.add(t.id)
    return next
  })
  return {
    conversation: { ...conversation, turns },
    perTurnRedacted,
  }
}

function sanitizeTurn(turn: Turn, rx: RegExp, replaceMap: Map<string, string>): Turn {
  // Reset rx state — global RegExps carry lastIndex across .replace
  // when reused across multiple inputs in older engines.
  rx.lastIndex = 0
  const next: Turn = {
    ...turn,
    body: turn.body.replace(rx, (match) => replaceMap.get(match) ?? '[redacted]'),
  }
  if (turn.author) {
    const bare = turn.author.replace(/^\[|\]$/g, '').trim()
    if (replaceMap.has(bare)) {
      next.author = `[${replaceMap.get(bare)}]`
    }
  }
  return next
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** FNV-1a 32-bit hash for deterministic legacy-turn id backfill. We
 *  intentionally use FNV (not the redact-detect content hash) — it's
 *  the cheapest stable function that's portable across the renderer
 *  and the future spool.pro web reader. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Backfill stable ids on any turns that lack one. Idempotent: turns
 *  with an existing `id` pass through untouched, so it's safe to call
 *  on every load path (`readSpoolFile`, draft open, session import). */
export function ensureTurnIds(turns: Turn[]): Turn[] {
  return turns.map((t, idx) =>
    t.id ? t : { ...t, id: `legacy-${idx}-${fnv1a32(t.body).toString(16)}` },
  )
}

export async function downloadSpoolFile(
  conversation: Conversation,
  opts: EditorOpts,
  options: BuildSpoolOptions = { sanitize: true },
): Promise<void> {
  // Default to sanitised for the user-facing download — opposite of
  // the in-memory builder, which assumes raw for autosave. The
  // explicit options arg lets callers override either way.
  const doc = buildSpoolDocument(conversation, opts, options)
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: MIME })
  await saveBlob(blob, filenameFor(conversation), {
    description: 'Spool Share document',
    mime: MIME,
    ext: '.spool',
  })
}

export async function readSpoolFile(file: File): Promise<SpoolDocument> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a valid .spool file (malformed JSON).')
  }
  if (!isSpoolDocument(parsed)) {
    throw new Error('Not a valid .spool file (unrecognized shape).')
  }
  // Backfill stable turn ids for v1 files (and any v2 that somehow
  // landed without ids). `ensureTurnIds` is idempotent.
  return {
    ...parsed,
    conversation: {
      ...parsed.conversation,
      turns: ensureTurnIds(parsed.conversation.turns),
    },
  }
}

function isSpoolDocument(v: unknown): v is SpoolDocument {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    (o.version === 1 || o.version === 2) &&
    typeof o.conversation === 'object' &&
    typeof o.opts === 'object'
  )
}

function filenameFor(c: Conversation): string {
  const safe = sanitizeFilename(c.title)
  const date = new Date().toISOString().slice(0, 10)
  return `${safe || 'spool'} · ${date}.spool`
}
