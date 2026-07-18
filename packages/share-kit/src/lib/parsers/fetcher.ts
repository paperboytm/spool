// Abstracts the "URL → markdown" step. Today: Jina Reader's hosted API
// (`r.jina.ai/<URL>`). Swappable later for Firecrawl, a self-hosted
// jina-ai/reader instance, or our own rendering service — the rest of
// the parser pipeline only sees `FetchedContent`, not the transport.

export interface FetchedContent {
  /** LLM-friendly markdown of the share page. */
  markdown: string
  /** Cleaned HTML of the share page. Only populated when the caller
   *  asks for it via `fetchContent(url, { withHtml: true })`. Some
   *  extractors (Claude) need the raw DOM to recover role markers that
   *  Jina's markdown path strips — sr-only headings, visually hidden
   *  bubbles, etc. */
  html?: string | undefined
  /** Upstream-derived page title. Usually platform-branded, so per-source
   *  extractors override this with something more specific. */
  title: string
  /** Canonical URL (may differ from input after redirects). */
  url: string
}

export class FetchError extends Error {
  constructor(
    message: string,
    public reason: 'network' | 'upstream' | 'malformed',
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

const JINA_BASE = 'https://r.jina.ai/'

interface JinaData {
  content?: string
  html?: string
  title?: string
  url?: string
}

async function jinaFetch(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<JinaData> {
  let res: Response
  try {
    res = await fetch(JINA_BASE + url, {
      headers: { Accept: 'application/json', ...extraHeaders },
    })
  } catch (err) {
    throw new FetchError(`Network error: ${(err as Error).message}`, 'network')
  }
  if (!res.ok) {
    throw new FetchError(`Jina returned ${res.status}`, 'upstream')
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new FetchError('Jina returned non-JSON', 'malformed')
  }
  const data = (body as { data?: JinaData }).data
  if (!data) {
    throw new FetchError('Jina response missing data', 'malformed')
  }
  return data
}

export async function fetchContent(
  url: string,
  opts: { withHtml?: boolean | undefined } = {},
): Promise<FetchedContent> {
  // Run the markdown + optional HTML fetches in parallel. The HTML
  // path is a secondary request (Jina only returns one format per
  // call), so paying its latency sequentially would roughly double
  // parse time.
  const [markdownData, htmlData] = await Promise.all([
    jinaFetch(url),
    opts.withHtml ? jinaFetch(url, { 'x-return-format': 'html' }) : Promise.resolve(null),
  ])

  if (typeof markdownData.content !== 'string') {
    throw new FetchError('Jina response missing data.content', 'malformed')
  }

  return {
    markdown: markdownData.content,
    html: htmlData?.html,
    title: markdownData.title ?? '',
    url: markdownData.url ?? url,
  }
}
