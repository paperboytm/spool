// Bridge between the editor's in-memory `Conversation` / `EditorOpts`
// pair and the wire-format `Snapshot` the backend accepts. The full
// snapshot machinery (stable turn ids in the .spool persistence layer,
// hidden-turn tracking, redaction span set) lands in later PRs; this
// keeps the publish modal end-to-end while those land.
//
// When the canonical Snapshot lives on the draft row, replace callers
// of this with that source and delete the file.

import type { Conversation, EditorOpts } from '@spool/share-kit'
import type { Snapshot } from '../../../shared/share-publish.js'

function turnId(idx: number): string {
  return `t${idx + 1}`
}

/**
 * Build a `Snapshot` from the editor's current Conversation + opts.
 * Turn ids are derived from the array index (`t1`, `t2`, …) — stable
 * across renders within a single session but NOT durable across draft
 * reloads.
 */
export function buildSnapshotFromEditor(args: {
  conversation: Conversation
  opts: EditorOpts
}): Snapshot {
  const { conversation, opts } = args
  const turns = conversation.turns.map((turn, idx) => ({
    id: turnId(idx),
    role: turn.role as 'user' | 'assistant',
    content: turn.body,
  }))
  return {
    schema_version: 1,
    source: {
      kind:
        conversation.origin.kind === 'file'
          ? 'imported-file'
          : conversation.origin.kind === 'agent-session'
            ? 'spool-session'
            : 'imported-file',
      captured_at: conversation.createdAt || new Date().toISOString(),
    },
    conversation: {
      title: conversation.title || 'Untitled',
      turns,
      turn_order: turns.map((t) => t.id),
      hidden_turns: [],
    },
    edits: [],
    redactions: [],
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
