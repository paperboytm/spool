// ChatGPT share extractor.
//
// Jina renders chatgpt.com/share/<id> into markdown with the pattern:
//
//   #### You said:
//   <user text>
//   #### ChatGPT said:
//   <assistant text>
//   ...
//
// Every turn is delimited by the `#### <role> said:` heading on its own
// line. ChatGPT's title is preserved by Jina as `data.title`.

import type { Turn } from '../../types'
import { ParseError, humanDate, normalizeBlock, stats, truncate, type ParserSource } from '../source'

const TURN_RX = /^####\s+(?:(You said):|(ChatGPT said):)\s*$/gm

// Page titles that mean Jina hit the "click to view" share-wall instead of
// the real conversation page — useless as a Spool title.
const GENERIC_TITLES = [/^see what this chat'?s about/i, /^chatgpt$/i]

// ChatGPT renders a stub HTML page for share IDs that don't exist / were
// removed / are private. Body is just the strings below — without this
// guard, the missing-role-markers fallback would happily render the error
// page as a "conversation".
const ERROR_PAGE_PATTERNS = [
  /can'?t load shared conversation/i,
  /conversation not found/i,
  /this shared conversation has been (removed|deleted)/i,
  /unable to load conversation/i,
]
const looksLikeErrorPage = (md: string) =>
  ERROR_PAGE_PATTERNS.some((rx) => rx.test(md))

export const chatgptSource: ParserSource = {
  id: 'chatgpt',
  platform: 'ChatGPT',
  matchUrl: (url) => /^https?:\/\/(?:chat(?:gpt)?\.com|chat\.openai\.com)\/share\//i.test(url),
  extract({ markdown, title, url }) {
    let turns = splitTurns(markdown)
    if (turns.length === 0) {
      const body = normalizeBlock(markdown)
      // Catch ChatGPT's "Can't load shared conversation" stub before the
      // single-turn fallback — otherwise we'd happily render the error page.
      if (!body || looksLikeErrorPage(body)) {
        throw new ParseError("ChatGPT couldn't load that share (it may be private, removed, or never existed)", 'malformed')
      }
      // ChatGPT now sometimes serves shares behind a "See what this chat's
      // about" preview wall; Jina extracts the assistant body but loses the
      // role headings and the user prompt. Render what we have as a single
      // assistant turn rather than failing outright.
      turns = [{ role: 'assistant', body }]
    }

    const trimmedTitle = title.trim()
    const isGeneric = GENERIC_TITLES.some((rx) => rx.test(trimmedTitle))
    // Strip the leading "ChatGPT - " if Jina returned the browser tab title.
    const cleanedTitle = (!isGeneric && trimmedTitle.replace(/^ChatGPT\s*[-—–]\s*/, '').trim()) || truncate(turns[0]!.body, 60)
    const { wordCount, readMin } = stats(turns)

    return {
      source: 'chatgpt',
      sourceLabel: 'ChatGPT',
      origin: { kind: 'web-share', platform: 'ChatGPT', url },
      title: cleanedTitle,
      shareUrl: url,
      createdAt: humanDate(),
      wordCount,
      readMin,
      turns,
    }
  },
}

function splitTurns(md: string): Turn[] {
  // `matchStart` marks where the heading's `####` begins; `bodyStart`
  // is just past the heading + its consumed trailing newline. The
  // body of heading i runs from i's bodyStart up to (i+1)'s matchStart —
  // don't be tempted to lastIndexOf a delimiter here; with runs of
  // empty headings (ChatGPT shares sometimes emit `#### You said:\n\n####
  // ChatGPT said:\n\n...` with no content), a backwards search can
  // overshoot into the next heading and fold its marker text into the
  // previous turn's body.
  const headings: { matchStart: number; bodyStart: number; role: 'user' | 'assistant' }[] = []
  let m: RegExpExecArray | null
  TURN_RX.lastIndex = 0
  while ((m = TURN_RX.exec(md)) !== null) {
    headings.push({
      matchStart: m.index,
      bodyStart: m.index + m[0].length,
      role: m[1] ? 'user' : 'assistant',
    })
  }
  const turns: Turn[] = []
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!
    const next = headings[i + 1]
    const blockEnd = next ? next.matchStart : md.length
    const body = normalizeBlock(md.slice(h.bodyStart, blockEnd))
    if (!body) continue
    // Some ChatGPT shares strip user-prompt text from the HTML (only the
    // assistant replies survive). We still want the Q→A rhythm to read
    // right, so front-load every content-bearing assistant turn with a
    // placeholder user turn whenever the preceding context is missing.
    if (h.role === 'assistant' && (turns.length === 0 || turns[turns.length - 1]!.role === 'assistant')) {
      turns.push({ role: 'user', author: '[you]', body: HIDDEN_PROMPT })
    }
    turns.push({
      role: h.role,
      author: h.role === 'user' ? '[you]' : undefined,
      body,
    })
  }
  return turns
}

// Shown in place of a user turn when ChatGPT's share page omits it.
// Kept short and unambiguous so it reads as a legit typographic marker
// rather than an error or a piece of real content.
const HIDDEN_PROMPT = '⟨ prompt not included in this share ⟩'
