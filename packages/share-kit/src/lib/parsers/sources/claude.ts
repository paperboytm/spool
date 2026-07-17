// Claude share extractor.
//
// Two paths, tried in order:
//
// 1. Jina's markdown — when it preserves the role headings, each turn
//    opens with `## You said:` or `## Claude responded:`. Fast, works
//    for most shares.
//
// 2. Raw HTML — for the shares where Jina's markdown pipeline drops
//    Claude's sr-only `<h2>` role headings (and sometimes the whole
//    user-message bubble along with them). We scan the HTML for those
//    headings and align their text against the markdown to recover
//    turn boundaries; if the user turn is missing from the markdown
//    entirely, the sr-only heading supplies the prompt text directly.

import type { Turn } from '../../types'
import {
  ParseError,
  decodeEntities,
  humanDate,
  normalizeBlock,
  stats,
  truncate,
  type ParserSource,
} from '../source'

const TURN_RX = /^##\s+(?:(You said):\s*|(Claude responded):\s*)(.*)$/gm
// Matches a standalone short-date line like "Oct 31, 2024"
const DATE_LINE_RX = /^\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\s*$/i
// sr-only role heading inside Claude's share HTML. The class list can
// include other utility classes, so we anchor on "sr-only" and allow
// anything either side.
const SR_ONLY_H2_RX = /<h2\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>\s*(You said|Claude responded):\s*([\s\S]*?)<\/h2>/gi

export const claudeSource: ParserSource = {
  id: 'claude',
  platform: 'Claude',
  needsHtml: true,
  matchUrl: (url) => /^https?:\/\/claude\.ai\/share\//i.test(url),
  extract({ markdown, html, url }) {
    const turns = splitByMarkdownHeadings(markdown) || splitByHtmlHeadings(markdown, html)
    if (!turns || turns.length === 0) {
      throw new ParseError(
        'Could not find any "## You said" / "## Claude responded" headings in Claude share',
        'malformed',
      )
    }

    const title =
      deriveTitleFromMarkdown(markdown) ??
      deriveTitleFromTurns(turns) ??
      truncate(turns[0]!.body, 60)
    const { wordCount, readMin } = stats(turns)
    const createdAt = extractDate(markdown) ?? humanDate()

    return {
      source: 'claude',
      sourceLabel: 'Claude',
      origin: { kind: 'web-share', platform: 'Claude', url },
      title,
      shareUrl: url,
      createdAt,
      wordCount,
      readMin,
      turns,
    }
  },
}

// ─── Primary path — markdown headings ──────────────────────────────

function splitByMarkdownHeadings(md: string): Turn[] | null {
  const headings: { index: number; role: 'user' | 'assistant'; firstLine: string }[] = []
  let m: RegExpExecArray | null
  TURN_RX.lastIndex = 0
  while ((m = TURN_RX.exec(md)) !== null) {
    headings.push({
      index: m.index,
      role: m[1] ? 'user' : 'assistant',
      firstLine: (m[3] ?? '').trim(),
    })
  }
  if (headings.length === 0) return null

  const turns: Turn[] = []
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!
    const next = headings[i + 1]
    const blockStart = h.index + md.slice(h.index).indexOf('\n') + 1
    const blockEnd = next ? next.index : md.length
    const body = stripDateLines(normalizeBlock(md.slice(blockStart, blockEnd)))
    // Claude echoes the first line both in the heading and the body; prefer
    // the body because it preserves newlines, but fall back to the heading
    // when the body is empty.
    const text = body || h.firstLine
    if (!text) continue
    turns.push({
      role: h.role,
      author: h.role === 'user' ? '[you]' : undefined,
      body: text,
    })
  }
  return turns
}

// ─── Fallback path — HTML sr-only headings ─────────────────────────

interface SrMarker {
  role: 'user' | 'assistant'
  /** Heading text, whitespace-collapsed. Claude's sr-only h2 carries
   *  the full turn content on a single line, so this is our source of
   *  truth for user prompts when the markdown doesn't include them. */
  text: string
}

function splitByHtmlHeadings(md: string, html: string | undefined): Turn[] | null {
  if (!html) return null
  const markers = extractSrOnlyMarkers(html)
  if (markers.length === 0) return null

  // Try to locate each marker's opening text inside the markdown so we
  // can grow the body with the nicely-formatted content Jina produced.
  // When a marker's text is absent from the markdown (common for user
  // turns — Claude's markdown pipeline sometimes drops the user bubble
  // entirely), fall back to the marker text itself.
  const mdPositions = markers.map((mk) => findAnchor(md, mk.text))

  const turns: Turn[] = []
  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i]!
    const pos = mdPositions[i]!
    const nextPos = mdPositions.slice(i + 1).find((p) => p !== -1) ?? md.length

    let body: string
    if (pos === -1) {
      // Anchor missing — the markdown doesn't carry this turn. Use the
      // sr-only heading text verbatim; for long user prompts it already
      // contains the whole message.
      body = normalizeBlock(mk.text)
    } else {
      body = stripDateLines(normalizeBlock(md.slice(pos, nextPos)))
      // Very short body → probably just the anchor and nothing after.
      // Prefer the sr-only text if it's richer.
      if (body.length < mk.text.length) body = normalizeBlock(mk.text)
    }

    if (!body) continue
    turns.push({
      role: mk.role,
      author: mk.role === 'user' ? '[you]' : undefined,
      body,
    })
  }
  return turns
}

function extractSrOnlyMarkers(html: string): SrMarker[] {
  const markers: SrMarker[] = []
  let m: RegExpExecArray | null
  SR_ONLY_H2_RX.lastIndex = 0
  while ((m = SR_ONLY_H2_RX.exec(html)) !== null) {
    const role = m[1] === 'You said' ? 'user' : 'assistant'
    const text = collapseWhitespace(decodeEntities(stripTags(m[2] ?? '')))
    if (!text) continue
    markers.push({ role, text })
  }
  return markers
}

/** Return a position in md where `needle`'s first distinctive segment
 *  appears, or -1 if not found. We match on the first ~40 chars to
 *  survive minor formatting drift (the sr-only heading is a flattened
 *  one-liner; the markdown version may preserve bold/italic runs). */
function findAnchor(md: string, needle: string): number {
  const probe = collapseWhitespace(needle).slice(0, 40).trim()
  if (!probe) return -1
  // Try the probe as-is first, then with whitespace collapsed on the
  // haystack side to handle wrapping.
  const direct = md.indexOf(probe)
  if (direct !== -1) return direct
  // Fallback: scan for the first 12 chars — enough to disambiguate for
  // normal prompts, loose enough to tolerate inserted formatting.
  const short = probe.slice(0, 12).trim()
  if (short.length >= 6) return md.indexOf(short)
  return -1
}

// Strip tag-like spans to a fixed point rather than in a single pass: a
// single `/<[^>]+>/g` pass is both an incomplete sanitizer (nested markup
// can survive one pass) and a polynomial-ReDoS risk (`[^>]` matches `<`,
// so a run of `<<<<...` backtracks quadratically). Excluding `<` from the
// character class removes the backtracking, and the loop closes the
// completeness gap.
function stripTags(s: string): string {
  let prev: string
  do {
    prev = s
    s = s.replace(/<[^<>]*>/g, '')
  } while (s !== prev)
  return s
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// ─── Shared helpers ────────────────────────────────────────────────

function stripDateLines(body: string): string {
  return body
    .split('\n')
    .filter((line) => !DATE_LINE_RX.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractDate(md: string): string | undefined {
  for (const line of md.split('\n')) {
    if (DATE_LINE_RX.test(line)) return line.trim()
  }
  return undefined
}

function deriveTitleFromMarkdown(md: string): string | undefined {
  // Claude's shared-snapshot intro has a sentence like:
  // "This is a copy of a chat between Claude and <user>."
  // Use the first user prompt as the title instead of the generic intro.
  const first = TURN_RX.exec(md)
  TURN_RX.lastIndex = 0
  if (!first) return undefined
  const line = (first[3] ?? '').trim()
  if (line.length > 8 && line.length < 120) return line
  return undefined
}

function deriveTitleFromTurns(turns: Turn[]): string | undefined {
  const firstUser = turns.find((t) => t.role === 'user')
  if (!firstUser) return undefined
  const flat = firstUser.body.replace(/\s+/g, ' ').trim()
  if (flat.length > 4 && flat.length < 120) return flat
  if (flat.length >= 120) return flat.slice(0, 60) + '…'
  return undefined
}
