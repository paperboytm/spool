// Map a wire-format Snapshot (what the share-backend serves on
// /api/snapshots/<id>) onto the in-memory `Conversation` + `EditorOpts`
// shape every template already understands. Pure data transform — no
// React, no DOM access — so the renderer side stays the only place
// React touches Snapshot data.
//
// SAFETY: this never emits HTML or runs eval. `turn.content` is
// already the redacted literal the publisher chose to send — the
// templates render it through React's text escaping.

import type {
  Conversation,
  EditorOpts,
  Snapshot,
  Template,
} from '../lib/types'
import {
  COLORWAYS,
  DEFAULT_OPTS,
  PAPERS,
  TEMPLATES,
  TYPEFACES,
} from '../lib/types'

const ROLE_MAP: Record<Snapshot['conversation']['turns'][number]['role'], 'user' | 'assistant'> = {
  user: 'user',
  assistant: 'assistant',
  // `system` / `tool` turns aren't first-class in the visual templates;
  // surface them as assistant so the content still renders rather than
  // silently disappears. The publish form already filters them upstream
  // when the user asks to; this is the safe fallback for anything that
  // slipped through.
  system: 'assistant',
  tool: 'assistant',
}

function safeTemplate(raw: string): Template {
  return (TEMPLATES.find((t) => t.id === raw)?.id ?? DEFAULT_OPTS.template) as Template
}

function safePaper(raw: string): EditorOpts['paper'] {
  return (PAPERS.find((p) => p.id === raw)?.id ?? DEFAULT_OPTS.paper) as EditorOpts['paper']
}

function safeTypeface(raw: string): EditorOpts['typeface'] {
  return (TYPEFACES.find((t) => t.id === raw)?.id ?? DEFAULT_OPTS.typeface) as EditorOpts['typeface']
}

function safeColorway(raw: string): { id: EditorOpts['colorway']; hex: string } {
  const found = COLORWAYS.find((c) => c.id === raw)
  if (found) return { id: found.id, hex: found.swatch }
  return { id: DEFAULT_OPTS.colorway, hex: DEFAULT_OPTS.accentHex }
}

// Forum / Letter / Timeline / Chat templates render `conversation.createdAt`
// verbatim, so we hand them an already-humanised string here rather than a
// raw ISO timestamp. `toLocaleDateString` without a locale uses the viewer's
// browser locale; the explicit short-form options keep the result tight
// (e.g. "Jun 3, 2026") instead of the full numeric "6/3/2026" some locales
// default to.
function humanDate(rawIso: string): string {
  const d = new Date(rawIso)
  if (isNaN(d.getTime())) return rawIso
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export interface DecodedSnapshot {
  conversation: Conversation
  opts: EditorOpts
}

const SUPPORTED_SCHEMA_VERSION = 1

export function decodeSnapshot(snapshot: Snapshot): DecodedSnapshot {
  // The wire object is server-validated at publish time, but a snapshot
  // written by a newer client could carry a future schema_version. We
  // best-effort decode (the field shapes the reader reads are stable)
  // and log once rather than throwing — callers like `paperHexFor`
  // invoke this outside the render error boundary, so a throw would
  // blank the whole page instead of degrading visibly.
  if (snapshot.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    console.warn(
      `decodeSnapshot: unsupported schema_version ${String(
        snapshot.schema_version,
      )} (supported: ${SUPPORTED_SCHEMA_VERSION}); decoding best-effort.`,
    )
  }

  const hidden = new Set(snapshot.conversation.hidden_turns ?? [])
  const orderIdx = new Map(
    (snapshot.conversation.turn_order ?? []).map((id, idx) => [id, idx]),
  )

  const turns = snapshot.conversation.turns
    .filter((t) => !hidden.has(t.id))
    .slice()
    .sort((a, b) => {
      const ai = orderIdx.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const bi = orderIdx.get(b.id) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
    // The `redacted` flag is intentionally dropped here — Reader Phase
    // A doesn't surface a per-turn badge, and the in-memory Turn shape
    // has no `isRedacted` field. Future Reader work can read it
    // straight off the Snapshot wire object.
    .map((t) => ({
      role: ROLE_MAP[t.role] ?? 'assistant',
      body: t.content,
    }))

  const colorway = safeColorway(snapshot.editor_opts.colorway)

  const conversation: Conversation = {
    source: 'spool',
    sourceLabel: 'Spool',
    origin: { kind: 'file', filename: 'snapshot' },
    title: snapshot.conversation.title || 'Untitled',
    shareUrl: null,
    createdAt: humanDate(snapshot.source.captured_at || new Date().toISOString()),
    wordCount: turns.reduce((acc, t) => acc + t.body.split(/\s+/).filter(Boolean).length, 0),
    readMin: 0,
    turns,
  }

  const opts: EditorOpts = {
    template: safeTemplate(snapshot.editor_opts.template),
    paper: safePaper(snapshot.editor_opts.paper),
    typeface: safeTypeface(snapshot.editor_opts.typeface),
    colorway: colorway.id,
    accentHex: colorway.hex,
    density: snapshot.editor_opts.density === 'relaxed' ? 'relaxed' : 'compact',
    redact: false,
    redactExclude: undefined,
    selected: undefined,
    showGaps: true,
    showMasthead: !!snapshot.editor_opts.masthead,
    showColophon: !!snapshot.editor_opts.colophon,
    hideEmptyTurns: true,
  }

  conversation.readMin = Math.max(1, Math.round(conversation.wordCount / 220))
  return { conversation, opts }
}
