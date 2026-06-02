// Source registry for share-link parsers.
//
// Each source is a pure transform from a `FetchedContent` bundle
// (markdown + metadata, produced by fetcher.ts via Jina Reader) into
// a normalized `Conversation`. Adding a new source = new file in
// `sources/`, register it in `registry.ts`. Nothing else has to change.

import type { Conversation, Platform } from '@/lib/types'
import type { FetchedContent } from './fetcher'

export type SourceId = 'chatgpt' | 'claude' | 'gemini'

export interface ParserSource {
  id: SourceId
  /** Display label, e.g. "ChatGPT". Becomes `Conversation.sourceLabel`. */
  platform: Platform
  /** True if this source can handle the given URL. */
  matchUrl(url: string): boolean
  /** When true, parseShareUrl pulls the page HTML alongside the markdown
   *  and hands it to extract via `FetchedContent.html`. Needed by
   *  sources whose role markers live in elements Jina's markdown
   *  conversion drops (e.g. Claude's sr-only headings). */
  needsHtml?: boolean | undefined
  /** Pure transform: fetched markdown → Conversation. Throws ParseError
   *  with a specific reason on failure — never silently return garbage. */
  extract(input: FetchedContent): Conversation
}

export type ParseErrorReason =
  | 'unknown-host'
  | 'private-page'
  | 'fetch-failed'
  | 'malformed'
  | 'extractor-not-implemented'

export class ParseError extends Error {
  constructor(message: string, public reason: ParseErrorReason) {
    super(message)
    this.name = 'ParseError'
  }
}

// ─── Helpers for source authors ──────────────────────────────────

/** Strip basic HTML entities (Jina can leak a few) + trim. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    // `&amp;` last so e.g. `&amp;lt;` decodes to the literal `&lt;`, not `<`.
    .replace(/&amp;/g, '&')
}

/** Word + read-time stats. Detects CJK content and counts characters
 *  instead of whitespace-delimited words — whitespace splitting
 *  treats 整段中文 as one "word", which looks silly in the header. */
export function stats(turns: { body: string }[]): { wordCount: number; readMin: number } {
  const joined = turns.map((t) => t.body).join(' ')
  // U+3000–U+9FFF (CJK symbols/punctuation through unified ideographs) plus
  // Hangul. The old class also listed the Hiragana/Katakana blocks, but those
  // sit inside U+3000–U+9FFF — pure overlap, same matches, now dropped.
  const cjkRe = /[　-鿿가-힯]/g
  const cjk = (joined.match(cjkRe) || []).length
  const latinWords = (joined.replace(cjkRe, ' ').trim().split(/\s+/).filter(Boolean)).length
  const wordCount = cjk + latinWords
  // Mixed content: weight CJK at 500 chars/min, Latin at 220 wpm
  const cjkMinutes = cjk / 500
  const latinMinutes = latinWords / 220
  const readMin = Math.max(1, Math.round(cjkMinutes + latinMinutes))
  return { wordCount, readMin }
}

export function humanDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Trim + collapse repeated blank lines (>=3 → 2). */
export function normalizeBlock(s: string): string {
  return decodeEntities(s)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Collapse all whitespace runs to single spaces and truncate with an
 *  ellipsis. Used by source extractors to derive a one-line title fallback
 *  when the share page didn't give us a usable one. */
export function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= n ? flat : flat.slice(0, n - 1) + '…'
}
