const EXPLICIT_FTS_OPERATOR = /\b(?:AND|OR|NOT|NEAR)\b/
const CJK_SEARCH_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export type FtsTableKind = 'unicode' | 'trigram'
export type SearchPlanStep = {
  query: string
  matchType: 'fts' | 'phrase' | 'all_terms'
}

export type PreviewFtsPlan = {
  tableKind: FtsTableKind
  query: string
  anyTermQuery: string
}

export function buildSearchPlan(query: string): SearchPlanStep[] {
  const normalized = normalizeWhitespace(query)
  if (!normalized) return [{ query: '""', matchType: 'fts' }]

  if (looksLikeExplicitFtsQuery(normalized)) {
    return [{ query: normalized, matchType: 'fts' }]
  }

  const terms = normalized.split(' ')
  if (terms.length === 1) {
    return [{ query: quoteFtsTerm(terms[0]!), matchType: 'fts' }]
  }

  return [
    { query: quoteFtsTerm(normalized), matchType: 'phrase' },
    { query: terms.map(quoteFtsTerm).join(' AND '), matchType: 'all_terms' },
  ]
}

export function buildFtsQuery(query: string): string {
  return buildSearchPlan(query)[0]?.query ?? '""'
}

export function getNaturalSearchTerms(query: string): string[] {
  const normalized = normalizeWhitespace(query)
  if (!normalized || looksLikeExplicitFtsQuery(normalized)) return []
  return normalized.split(' ')
}

export function getNaturalSearchPhrase(query: string): string {
  return normalizeWhitespace(query)
}

export function selectFtsTableKind(query: string): FtsTableKind {
  return CJK_SEARCH_CHAR.test(query) ? 'trigram' : 'unicode'
}

export function containsCjk(value: string): boolean {
  return CJK_SEARCH_CHAR.test(value)
}

export function shouldUseSessionFallback(query: string): boolean {
  const terms = getNaturalSearchTerms(query)
  if (terms.length < 2) return false
  return terms.some(term => containsShortCjkTerm(term))
}

export function canUseSessionSearchFts(query: string): boolean {
  const terms = getNaturalSearchTerms(query)
  if (terms.length === 0) return false
  return terms.every(term => !containsShortCjkTerm(term))
}

export function buildPreviewFtsPlan(query: string): PreviewFtsPlan | null {
  const terms = getNaturalSearchTerms(query)
  if (terms.length === 0) return null

  const tableKind = selectFtsTableKind(query)
  // Plan terms are ANDed, so a single unmatchable term zeroes out the whole
  // preview. Trigram phrases never match below 3 codepoints (`错误码 42`),
  // and unicode61 tokenizes punctuation-only terms to an empty phrase
  // (`foo =>`). Either shape falls back to the LIKE scan.
  const unmatchable = tableKind === 'trigram'
    ? (term: string) => Array.from(term).length < 3
    : (term: string) => !/[\p{L}\p{N}]/u.test(term)
  if (terms.some(unmatchable)) return null

  const ftsTerms = tableKind === 'unicode'
    ? terms.map(term => `${quoteFtsTerm(term)}*`)
    : terms.map(quoteFtsTerm)

  return {
    tableKind,
    query: ftsTerms.join(' AND '),
    anyTermQuery: ftsTerms.join(' OR '),
  }
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function looksLikeExplicitFtsQuery(query: string): boolean {
  return query.includes('"')
    || query.includes('*')
    || query.includes('(')
    || query.includes(')')
    || EXPLICIT_FTS_OPERATOR.test(query)
}

function quoteFtsTerm(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function containsShortCjkTerm(term: string): boolean {
  return CJK_SEARCH_CHAR.test(term) && Array.from(term).length < 3
}
