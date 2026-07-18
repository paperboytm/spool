import type { SessionViewV1 } from '@spool-lab/session-kit'

import type { WorkspaceCard } from './workspace.js'

// Deterministic note prefill (design §3.2): intent from the first prompt,
// outcome from the last reply, plus the machine evidence summary. Shown as
// comment lines in $EDITOR; published verbatim under --no-edit.

const LINE_WIDTH = 120

export function buildNotePrefill(opts: {
  view: SessionViewV1
  card: WorkspaceCard | null
  count: number
}): string {
  const { view, card, count } = opts
  const lines: string[] = [
    'Spool share draft — write for the person receiving this session:',
    'why you are sharing it, what they need to know to take over, and',
    'where you want review. Lines below are prefilled from the records.',
    '',
    `Intent (first prompt): ${firstLine(view.firstPrompt)}`,
    `Outcome (last reply): ${firstLine(view.lastReply)}`,
    `Records shared: ${count}`,
    `Diffstat: ${view.diffstat.files} files +${view.diffstat.adds} -${view.diffstat.dels}`,
  ]
  if (view.files.length > 0) {
    lines.push(
      `Files: ${view.files
        .slice(0, 8)
        .map((file) => file.path)
        .join(', ')}${view.files.length > 8 ? ', …' : ''}`,
    )
  }
  if (card) {
    const dirty = card.dirty.length > 0 ? `, ${card.dirty.length} dirty file(s)` : ''
    lines.push(
      `Workspace: ${card.branch ?? '(detached)'} @ ${card.head?.slice(0, 7) ?? '?'}${dirty}`,
    )
  }
  return lines.join('\n')
}

function firstLine(value: string): string {
  const line = value.split('\n', 1)[0] ?? ''
  return line.length > LINE_WIDTH ? `${line.slice(0, LINE_WIDTH)}…` : line || '(empty)'
}
