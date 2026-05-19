// @spool/share-kit — building blocks for the Spool Share editor surface.
// Consumers (Spool app, spool.share web) assemble these into their own
// editor pages; the kit itself is host-agnostic (no routing, no global
// state, no IPC).

// ─── Domain types ────────────────────────────────────────────────
export type {
  Platform,
  Origin,
  TurnRole,
  Turn,
  Conversation,
  Template,
  Paper,
  Typeface,
  Density,
  PaperTokens,
  PaperDef,
  TypefaceDef,
  Colorway,
  EditorOpts,
  RedactExclude,
  SpoolDocument,
} from './lib/types'

export {
  PAPERS,
  TYPEFACES,
  COLORWAYS,
  TEMPLATES,
  TEMPLATE_RATIO,
  SOURCE_DOTS,
  DEFAULT_OPTS,
  paperTokens,
  typefaceFamily,
  chromeMode,
  normalizeOpts,
} from './lib/types'

export { FIXTURE_PASTED } from './lib/fixtures'

// ─── Template renderers ─────────────────────────────────────────
export { TemplateRender } from './templates'
export { Forum } from './templates/forum'
export { Letter } from './templates/letter'
export { Timeline } from './templates/timeline'
export { Chat } from './templates/chat'

// ─── Template primitives (for hosts assembling custom layouts) ──
export { Body } from './templates/body'
export { GapMarker } from './templates/gap-marker'

// ─── Visual components ──────────────────────────────────────────
export { Wordmark } from './components/wordmark'
export { SourceMark } from './components/source-mark'
export * as Icons from './components/icons'

// ─── Exporters (local, in-browser) ──────────────────────────────
export {
  exportArtifact,
  saveBlob,
  openSaveSlot,
  writeToSlot,
  rasterizeToPngBlob,
  installPdfPrintHost,
  filenameForExport,
} from './lib/export'
export type { ExportFormat, SaveSlot } from './lib/export'
export { PngTooTallError } from './lib/export'

// .spool file format ──────────────────────────────────────────────
export {
  buildSpoolDocument,
  downloadSpoolFile,
  readSpoolFile,
  ensureTurnIds,
  redactConversation,
} from './lib/storage/spool-file'

// Markdown export ─────────────────────────────────────────────────
export {
  buildMarkdownDocument,
  downloadMarkdownFile,
  markdownFilenameFor,
} from './lib/storage/markdown-file'

// Preview document (slim subset for thumbnail caches) ─────────────
export {
  buildPreviewDocument,
  PREVIEW_TURN_COUNT,
} from './lib/storage/preview-document'

// ─── Parsers (Phase 1 — accepts public ChatGPT/Claude/Gemini share URLs) ──
export { parseShareUrl, detectPlatform, ParseError } from './lib/parsers'
export type { ParseErrorReason } from './lib/parsers'
export { fetchContent, FetchError } from './lib/parsers/fetcher'
export type { FetchedContent } from './lib/parsers/fetcher'

// ─── Local draft storage (IndexedDB; for spool.share web) ───────
export {
  saveDraft,
  loadDraft,
  loadCurrentDraft,
  listDrafts,
  deleteDraft,
  draftIdFor,
} from './lib/storage/drafts'
export type { Draft } from './lib/storage/drafts'

// ─── Sensitive-data detection ───────────────────────────────────
export {
  detectSensitiveSpans,
  groupBySensitiveKind,
  hashValueForRedactExclude,
  SENSITIVE_KIND_LABEL,
} from './lib/redaction-detect'
export type {
  SensitiveKind,
  SensitiveMatch,
  SensitiveGroup,
  SensitiveValue,
} from './lib/redaction-detect'
export {
  detectPII,
  collectRedactList,
  applyRedactPolicy,
  SYNTHETIC_KIND_AUTHOR,
  SYNTHETIC_KIND_MANUAL,
} from './templates/redact'
export type { PIIDetection } from './templates/redact'
