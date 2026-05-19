// Map a wire-format Snapshot (what the share-backend serves on
// /api/snapshots/<id>) onto the in-memory `Conversation` + `EditorOpts`
// shape every template already understands. Pure data transform — no
// React, no DOM access — so the renderer side stays the only place
// React touches Snapshot data.
//
// SAFETY: this never emits HTML or runs eval. The `applied_content`
// of each turn is just the redacted/edited plain string the templates
// will render through React's text escaping.

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

function applyEditsAndRedactions(
  rawContent: string,
  turnId: string,
  snapshot: Snapshot,
): string {
  const edit = snapshot.edits.find((e) => e.turn_id === turnId)
  let content = edit ? edit.edited_content : rawContent

  const redactions = snapshot.redactions
    .filter((r) => r.turn_id === turnId)
    // Apply right-to-left so earlier offsets stay valid as we splice.
    .sort((a, b) => b.span[0] - a.span[0])

  for (const r of redactions) {
    const [start, end] = r.span
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      start < 0 ||
      end > content.length ||
      start >= end
    ) {
      continue
    }
    const label = r.label || '[redacted]'
    content = content.slice(0, start) + label + content.slice(end)
  }
  return content
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

export interface DecodedSnapshot {
  conversation: Conversation
  opts: EditorOpts
}

export function decodeSnapshot(snapshot: Snapshot): DecodedSnapshot {
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
    .map((t) => ({
      role: ROLE_MAP[t.role] ?? 'assistant',
      body: applyEditsAndRedactions(t.content, t.id, snapshot),
    }))

  const colorway = safeColorway(snapshot.editor_opts.colorway)

  const conversation: Conversation = {
    source: 'spool',
    sourceLabel: 'Spool',
    origin: { kind: 'file', filename: 'snapshot' },
    title: snapshot.conversation.title || 'Untitled',
    shareUrl: null,
    createdAt: snapshot.source.captured_at || new Date().toISOString(),
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
