// Markdown export — plain text, template-agnostic.
//
// Honors the editor's content-affecting opts (selected, redact,
// hideEmptyTurns, showGaps, showMasthead, showColophon). Visual opts
// (template, paper, typeface, colorway, density) don't
// translate to markdown and are ignored.
//
// Body redactions reuse the same auto-detection used by the templates
// (emails + bracketed author names + manual turn.redact entries), with
// each match swapped for a backticked `[redacted]` so it reads as a
// chip in any markdown renderer.

import type { Conversation, EditorOpts } from '../types'
import { selectSegments } from '../../templates/selection'
import { collectRedactList } from '../../templates/redact'
import { saveBlob } from '../export'
import { sanitizeFilename } from '../filename'

const MIME = 'text/markdown'

export function buildMarkdownDocument(conversation: Conversation, opts: EditorOpts): string {
  const { turns, gapBefore } = selectSegments(conversation, opts)
  const redactList = opts.redact ? collectRedactList(turns, opts) : []
  const redactMap = new Map(redactList.map((r) => [r.value, r.replacement]))
  const redactRx = redactList.length
    ? new RegExp(redactList.map((r) => escapeRx(r.value)).join('|'), 'g')
    : null
  // Per-kind substitution wrapped in backticks so the masked span
  // reads as a chip in any markdown renderer.
  const substitute = (text: string): string =>
    redactRx
      ? text.replace(redactRx, (match) => '`' + (redactMap.get(match) ?? '[redacted]') + '`')
      : text

  const lines: string[] = []

  lines.push('---')
  lines.push(`title: ${yamlStr(conversation.title)}`)
  lines.push(`source: ${yamlStr(conversation.sourceLabel)}`)
  if (conversation.shareUrl) lines.push(`source_url: ${yamlStr(conversation.shareUrl)}`)
  lines.push(`captured_at: ${yamlStr(conversation.createdAt)}`)
  lines.push(`exported_at: ${yamlStr(new Date().toISOString())}`)
  lines.push('---')
  lines.push('')

  lines.push(`# ${conversation.title}`)
  lines.push('')

  if (opts.showMasthead) {
    const bits: string[] = [`From ${conversation.sourceLabel}`]
    if (conversation.shareUrl) bits.push(`[original](${conversation.shareUrl})`)
    bits.push(conversation.createdAt)
    lines.push(`*${bits.join(' · ')}*`)
    lines.push('')
  }

  turns.forEach((turn, i) => {
    const gap = gapBefore[i] ?? 0
    if (opts.showGaps && gap > 0) {
      lines.push(`*⋯ ${gap} turn${gap === 1 ? '' : 's'} skipped*`)
      lines.push('')
      lines.push('---')
      lines.push('')
    } else if (i > 0) {
      lines.push('---')
      lines.push('')
    }
    const name = turn.role === 'user'
      ? (turn.author?.replace(/^\[|\]$/g, '').trim() || 'User')
      : conversation.sourceLabel
    lines.push(`**${name}:**`)
    lines.push('')
    lines.push(substitute(turn.body))
    lines.push('')
  })

  return lines.join('\n')
}

export async function downloadMarkdownFile(
  conversation: Conversation,
  opts: EditorOpts,
): Promise<void> {
  const md = buildMarkdownDocument(conversation, opts)
  const blob = new Blob([md], { type: MIME })
  await saveBlob(blob, filenameFor(conversation), {
    description: 'Markdown document',
    mime: MIME,
    ext: '.md',
  })
}

export function markdownFilenameFor(c: Conversation): string {
  return filenameFor(c)
}

/** Keep in sync with `templates/body.tsx#preprocess` — both must
 *  substitute the same literal so the on-screen chip and the exported
 *  markdown carry the same redaction marker. */
function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** YAML 1.2 is a JSON superset for quoted scalars, so JSON.stringify
 *  produces a valid double-quoted YAML string with correct escaping. */
function yamlStr(s: string): string {
  return JSON.stringify(s)
}

function filenameFor(c: Conversation): string {
  const safe = sanitizeFilename(c.title)
  const date = new Date().toISOString().slice(0, 10)
  return `${safe || 'spool'} · ${date}.md`
}
