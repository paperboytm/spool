import {
  COLORWAYS,
  DEFAULT_OPTS,
  normalizeOpts,
  type Conversation,
  type EditorOpts,
  type Origin,
  type SpoolDocument,
  type Turn,
} from './types'

type UnknownRecord = Record<string, unknown>

/**
 * Parse the public `.spool` trust boundary into a fully normalized document.
 *
 * Legacy v1/v2 documents may omit conversation metadata and newer option
 * fields, so those receive deterministic safe defaults. Turn payloads are the
 * actual authored content and are never guessed: a malformed turn rejects the
 * whole document instead of leaving a renderer to fail halfway through.
 */
export function parseSpoolDocument(input: unknown): SpoolDocument | null {
  if (!isRecord(input) || (input.version !== 1 && input.version !== 2)) return null
  if (!isRecord(input.conversation) || !Array.isArray(input.conversation.turns)) return null

  const turns: Turn[] = []
  for (const rawTurn of input.conversation.turns) {
    const turn = parseTurn(rawTurn)
    if (turn === null) return null
    turns.push(turn)
  }

  const exportedAt = stringOr(input.exportedAt, '')
  const conversation = parseConversation(input.conversation, turns, exportedAt)
  const opts = parseOpts(input.opts, turns.length)

  return {
    version: input.version,
    conversation,
    opts,
    exportedAt,
  }
}

function parseTurn(input: unknown): Turn | null {
  if (!isRecord(input)) return null
  if (input.role !== 'user' && input.role !== 'assistant') return null
  if (typeof input.body !== 'string') return null
  if (!optionalString(input.id)) return null
  if (!optionalString(input.author)) return null
  if (!optionalString(input.timestamp)) return null
  if (
    input.redact !== undefined &&
    (!Array.isArray(input.redact) || !input.redact.every((value) => typeof value === 'string'))
  )
    return null

  return {
    ...(typeof input.id === 'string' ? { id: input.id } : {}),
    role: input.role,
    ...(typeof input.author === 'string' ? { author: input.author } : {}),
    body: input.body,
    ...(Array.isArray(input.redact) ? { redact: input.redact } : {}),
    ...(typeof input.timestamp === 'string' ? { timestamp: input.timestamp } : {}),
  }
}

function parseConversation(input: UnknownRecord, turns: Turn[], exportedAt: string): Conversation {
  const wordCount = turns.reduce(
    (total, turn) => total + turn.body.split(/\s+/).filter(Boolean).length,
    0,
  )
  const source = stringOr(input.source, 'spool')
  const conversation: Conversation = {
    source,
    sourceLabel: stringOr(input.sourceLabel, source === 'spool' ? 'Spool' : source),
    origin: parseOrigin(input.origin),
    title: stringOr(input.title, 'Shared session'),
    shareUrl: typeof input.shareUrl === 'string' ? input.shareUrl : null,
    createdAt: stringOr(input.createdAt, exportedAt),
    wordCount: nonNegativeFiniteOr(input.wordCount, wordCount),
    readMin: nonNegativeFiniteOr(input.readMin, Math.max(1, Math.ceil(wordCount / 200))),
    turns,
  }
  if (typeof input.shortUrl === 'string') conversation.shortUrl = input.shortUrl
  return conversation
}

function parseOrigin(input: unknown): Origin {
  if (!isRecord(input)) return { kind: 'file', filename: 'shared.spool' }
  if (
    input.kind === 'web-share' &&
    (input.platform === 'ChatGPT' || input.platform === 'Claude' || input.platform === 'Gemini')
  ) {
    return {
      kind: 'web-share',
      platform: input.platform,
      ...(typeof input.url === 'string' ? { url: input.url } : {}),
    }
  }
  if (input.kind === 'agent-session' && typeof input.agent === 'string') {
    return {
      kind: 'agent-session',
      agent: input.agent,
      ...(typeof input.sessionUuid === 'string' ? { sessionUuid: input.sessionUuid } : {}),
    }
  }
  if (input.kind === 'file' && typeof input.filename === 'string') {
    return { kind: 'file', filename: input.filename }
  }
  return { kind: 'file', filename: 'shared.spool' }
}

function parseOpts(input: unknown, turnCount: number): EditorOpts {
  const raw = isRecord(input) ? input : {}
  const normalized = normalizeOpts(raw)
  const colorway = COLORWAYS.find((candidate) => candidate.id === normalized.colorway)
  const accentFallback = colorway?.swatch ?? DEFAULT_OPTS.accentHex
  const selected = Array.isArray(raw.selected)
    ? [
        ...new Set(
          raw.selected.filter(
            (value): value is number => Number.isInteger(value) && value >= 0 && value < turnCount,
          ),
        ),
      ]
    : undefined

  const opts: EditorOpts = {
    template: normalized.template,
    paper: normalized.paper,
    typeface: normalized.typeface,
    colorway: normalized.colorway,
    accentHex:
      typeof raw.accentHex === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accentHex)
        ? raw.accentHex
        : accentFallback,
    density:
      raw.density === 'compact' || raw.density === 'relaxed' ? raw.density : DEFAULT_OPTS.density,
    redact: typeof raw.redact === 'boolean' ? raw.redact : DEFAULT_OPTS.redact,
    selected,
    showGaps: typeof raw.showGaps === 'boolean' ? raw.showGaps : DEFAULT_OPTS.showGaps,
    showMasthead:
      typeof raw.showMasthead === 'boolean' ? raw.showMasthead : DEFAULT_OPTS.showMasthead,
    showColophon:
      typeof raw.showColophon === 'boolean' ? raw.showColophon : DEFAULT_OPTS.showColophon,
    hideEmptyTurns:
      typeof raw.hideEmptyTurns === 'boolean' ? raw.hideEmptyTurns : DEFAULT_OPTS.hideEmptyTurns,
  }
  if (normalized.redactExclude !== undefined) opts.redactExclude = normalized.redactExclude
  return opts
}

function isRecord(input: unknown): input is UnknownRecord {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function optionalString(input: unknown): boolean {
  return input === undefined || typeof input === 'string'
}

function stringOr(input: unknown, fallback: string): string {
  return typeof input === 'string' ? input : fallback
}

function nonNegativeFiniteOr(input: unknown, fallback: number): number {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : fallback
}
