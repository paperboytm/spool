// Frontend entry to the parser. Takes a share URL, returns a
// normalized Conversation.
//
// Flow:
//   1. Look up the right ParserSource by URL pattern.
//   2. Fetch the page's markdown via the shared fetcher (Jina today).
//   3. Run the source's pure `extract(markdown) → Conversation`.
//
// No Cloudflare Worker, no proxy — Jina Reader serves CORS-open
// responses that we can fetch straight from the browser.

import type { Conversation, Platform } from '../types'
import { FetchError, fetchContent } from './fetcher'
import { findSource } from './registry'
import { ParseError, type ParseErrorReason } from './source'

export { ParseError } from './source'
export type { ParseErrorReason } from './source'

/** Quick local check — drives the Home page "typed"/"error" UI. */
export function detectPlatform(url: string): Platform | null {
  const src = findSource(url.trim())
  if (!src) return null
  const id = src.id
  if (id === 'chatgpt') return 'ChatGPT'
  if (id === 'claude') return 'Claude'
  if (id === 'gemini') return 'Gemini'
  return null
}

export async function parseShareUrl(url: string): Promise<Conversation> {
  const source = findSource(url)
  if (!source) {
    throw new ParseError('Not a recognized share URL', 'unknown-host')
  }

  let content
  try {
    content = await fetchContent(url, { withHtml: source.needsHtml })
  } catch (err) {
    if (err instanceof FetchError) {
      const reason: ParseErrorReason = err.reason === 'network' ? 'fetch-failed' : 'fetch-failed'
      throw new ParseError(`Could not fetch page (${err.reason}): ${err.message}`, reason)
    }
    throw new ParseError(`Fetch failed: ${(err as Error).message}`, 'fetch-failed')
  }

  try {
    return source.extract(content)
  } catch (err) {
    if (err instanceof ParseError) throw err
    throw new ParseError(`Extractor failed: ${(err as Error).message}`, 'malformed')
  }
}
