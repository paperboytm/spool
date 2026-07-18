// Gemini share extractor.
//
// Gemini's rendered share has a one-sided delimiter: user prompts are
// marked with a bare `You said` line, but the assistant reply has no
// label and just follows after a blank line. Structure:
//
//   ...<nav chrome>...
//   You said
//   <user text>
//
//   <assistant text spanning multiple paragraphs, bullets, code>
//
//   You said
//   <user text>
//
//   <assistant text>
//   ...
//   <footer chrome — Google Privacy Policy links, etc>
//
// Strategy: slice from first `You said` to a recognised footer marker,
// then split on `^You said\s*$`. For each segment, the first paragraph
// is the user prompt; the rest is the assistant reply.

import type { Turn } from '../../types'
import { ParseError, humanDate, normalizeBlock, stats, type ParserSource } from '../source'

// Jina emits the line as ` You said ` (leading + trailing spaces) because
// Gemini wraps the label in a styled span — allow horizontal whitespace
// on both sides so the first-marker lookup doesn't silently miss.
const YOU_SAID_RX = /^[ \t]*You said[ \t]*$/m
const YOU_SAID_SPLIT_RX = /\n[ \t]*You said\s*\n/g
// Distinctive footer anchors — strings that are extremely unlikely to
// appear in real chat content. Using \s+ instead of literal spaces makes
// matching robust to non-breaking spaces and line breaks from Jina.
const FOOTER_ANCHORS: RegExp[] = [
  /Google\s+Privacy\s+Policy/i,
  /Google\s+Terms\s+of\s+Service/i,
  /Your\s+privacy\s+&\s+Gemini\s+Apps/i,
  /Gemini\s+may\s+display\s+inaccurate/i,
  /Copy\s+public\s+link/i,
  /policies\.google\.com/i,
  /support\.google\.com\/gemini/i,
]

export const geminiSource: ParserSource = {
  id: 'gemini',
  platform: 'Gemini',
  matchUrl: (url) => /^https?:\/\/(?:g\.co\/gemini|gemini\.google\.com)\/share\//i.test(url),
  extract({ markdown, url }) {
    const body = sliceBetweenMarkers(markdown)
    const segments = splitSegments(body)
    const turns: Turn[] = []
    for (const seg of segments) {
      const [user, assistant] = splitUserAssistant(seg)
      if (user) {
        turns.push({ role: 'user', author: '[you]', body: user })
      }
      if (assistant) {
        turns.push({ role: 'assistant', body: assistant })
      }
    }
    if (turns.length === 0) {
      throw new ParseError('Could not find any "You said" markers in Gemini share', 'malformed')
    }

    const title = turns[0]!.body.split('\n')[0]!.slice(0, 80)
    const { wordCount, readMin } = stats(turns)

    return {
      source: 'gemini',
      sourceLabel: 'Gemini',
      origin: { kind: 'web-share', platform: 'Gemini', url },
      title,
      shareUrl: url,
      createdAt: humanDate(),
      wordCount,
      readMin,
      turns,
    }
  },
}

function sliceBetweenMarkers(md: string): string {
  // Find the first `You said` line to strip the nav chrome above it.
  const start = md.search(YOU_SAID_RX)
  if (start < 0) return md
  let body = md.slice(start)
  // Truncate at the earliest matched footer anchor, then back the cut up
  // to the preceding paragraph boundary so we don't leave stragglers like
  // a bare `[` from a markdown link whose text starts with the anchor.
  let footerIdx = body.length
  for (const pattern of FOOTER_ANCHORS) {
    const m = body.match(pattern)
    if (m && m.index !== undefined && m.index < footerIdx) footerIdx = m.index
  }
  if (footerIdx < body.length) {
    const before = body.slice(0, footerIdx)
    const paraBreak = before.lastIndexOf('\n\n')
    if (paraBreak >= 0) footerIdx = paraBreak
  }
  return body.slice(0, footerIdx).trim()
}

function splitSegments(body: string): string[] {
  // Ensure the first `You said` is consumed by the split too
  const padded = '\n' + body
  const parts = padded.split(YOU_SAID_SPLIT_RX)
  // The first element is the intro before the first `You said`; discard.
  return parts
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitUserAssistant(segment: string): [string, string] {
  // Heuristic: first paragraph = user prompt. Rest = assistant reply.
  // "Paragraph" = lines up to the first blank line.
  const firstBlank = segment.search(/\n\s*\n/)
  if (firstBlank < 0) {
    // No separator — treat the whole segment as a user-only turn
    // (happens for the last turn if the user didn't get a reply).
    return [normalizeBlock(segment), '']
  }
  const user = normalizeBlock(segment.slice(0, firstBlank))
  const assistant = normalizeBlock(segment.slice(firstBlank))
  return [user, assistant]
}
