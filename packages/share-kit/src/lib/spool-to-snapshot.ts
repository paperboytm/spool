// Pure display transform: a .spool document → the wire Snapshot the
// reader renders. Used by the spool.pro session page to show the .spool
// file attached to a hub share. No redaction here — attached documents
// are sanitized at build time (buildSpoolDocument sanitize: true); this
// mirrors the id-opaquing + hidden-turn blanking rules of the app's
// publish adapter so a converted document renders exactly like a
// published snapshot.

import { ensureTurnIds } from './storage/spool-file'
import type { Snapshot, SnapshotTurn, SpoolDocument } from './types'

function toIsoOrNow(input: string | undefined): string {
  if (!input) return new Date().toISOString()
  const t = Date.parse(input)
  if (Number.isNaN(t)) return new Date().toISOString()
  return new Date(t).toISOString()
}

export function snapshotFromSpoolDocument(doc: SpoolDocument): Snapshot {
  const conversation = doc.conversation
  const turns = ensureTurnIds(conversation.turns)

  const selected = doc.opts.selected
  const hiddenIndices = new Set(
    selected === undefined
      ? []
      : turns.map((_, idx) => idx).filter((idx) => !selected.includes(idx)),
  )

  const snapshotTurns: SnapshotTurn[] = turns.map((turn, idx) => ({
    id: `t${idx}`,
    role: turn.role === 'user' ? 'user' : 'assistant',
    content: hiddenIndices.has(idx) ? '' : turn.body,
  }))

  return {
    schema_version: 1,
    source: {
      kind:
        conversation.origin.kind === 'agent-session' ? 'spool-session' : 'imported-file',
      captured_at: toIsoOrNow(conversation.createdAt || doc.exportedAt),
    },
    conversation: {
      title: conversation.title || 'Untitled',
      turns: snapshotTurns,
      turn_order: snapshotTurns.map((turn) => turn.id),
      hidden_turns: snapshotTurns
        .filter((_, idx) => hiddenIndices.has(idx))
        .map((turn) => turn.id),
    },
    editor_opts: {
      template: doc.opts.template,
      paper: doc.opts.paper,
      typeface: doc.opts.typeface,
      colorway: doc.opts.colorway,
      density: doc.opts.density,
      masthead: doc.opts.showMasthead,
      colophon: doc.opts.showColophon,
      avatars: true,
      show_byline: false,
    },
  }
}
