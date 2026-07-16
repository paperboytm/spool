// Core domain types for Spool Share.
//
// `Conversation` is the source-agnostic shape that every adapter
// (paste link, dropped .spool file, future: direct app handoff)
// normalizes into. The editor reads this and never cares where it
// came from — except via `origin`, which drives the source chip
// rendering in the top bar.

export type Platform = 'ChatGPT' | 'Claude' | 'Gemini'

/** Where a `Conversation` came from. Drives the source chip in the
 *  editor topbar and lets future security/cleanup features
 *  distinguish web pastes from local agent recordings.
 *
 *  - `web-share`: user pasted a public share URL (chatgpt.com /
 *    claude.ai / gemini.google.com). The shared URL is the user's
 *    own published artifact — public-by-design.
 *  - `agent-session`: user opened a local `.spool` session captured
 *    from a coding agent (Claude Code, codex, gemini-cli, antigravity-cli). The
 *    transcript was never public — agent transcripts can contain
 *    secrets the agent read off disk and that the user never
 *    intended to publish, which is why the Privacy panel exists.
 *    The planned Security Scan feature only sweeps `agent-session`
 *    conversations.
 *  - `file`: user dropped a `.spool` file (Spool's portable format). */
export type Origin =
  | { kind: 'web-share'; platform: Platform; url?: string }
  | { kind: 'agent-session'; agent: string; sessionUuid?: string }
  | { kind: 'file'; filename: string }

export type TurnRole = 'user' | 'assistant'

export interface Turn {
  /** Stable id within the editor; backfilled deterministically on load
   *  by `ensureTurnIds` for older drafts/`.spool v1` files. Optional
   *  in source-of-truth Conversation objects so importers (chat
   *  parsers) don't need to invent ids — every load path runs through
   *  `ensureTurnIds` before the data reaches the editor. */
  id?: string | undefined
  role: TurnRole
  /** Display name for user turns, e.g. "[Maya]" or "[you]". Omitted for assistant. */
  author?: string | undefined
  body: string
  /** Literal substrings to redact when `opts.redact` is on. */
  redact?: string[] | undefined
  /** ISO timestamp of when this turn was sent/received. Optional —
   *  legacy drafts (saved before this field existed) leave it undefined.
   *  Used by the timeline template's rail markers; other templates can
   *  ignore it. */
  timestamp?: string | undefined
}

export interface Conversation {
  /** Machine ID, lowercased: 'claude' | 'chatgpt' | 'gemini' | 'claude-code' | ... */
  source: string
  /** Display label, e.g. "Claude" or "Claude Code". */
  sourceLabel: string
  origin: Origin
  title: string
  /** Public share URL when applicable. Null for file origins. */
  shareUrl: string | null
  /** Hosted spool.pro short URL. Only present after publish (Phase 2+). */
  shortUrl?: string
  createdAt: string
  wordCount: number
  readMin: number
  turns: Turn[]
}

export type Template = 'forum' | 'letter' | 'timeline' | 'chat'
export type Paper = 'bone' | 'snow' | 'graphite' | 'ink'
export type Typeface = 'inter' | 'geist' | 'fraunces' | 'hanken-grotesk'
export type Density = 'compact' | 'relaxed'

export interface PaperTokens {
  paper: string
  text: string
  muted: string
  faint: string
  border: string
  surface: string
  accentBg: string
}

export interface PaperDef {
  id: Paper
  name: string
  tokens: PaperTokens
}

export const PAPERS: PaperDef[] = [
  {
    id: 'snow',
    name: 'Snow',
    tokens: {
      paper: '#FCFCFA',
      text: '#1C1C18',
      muted: '#6B6B60',
      faint: '#B0B0AD',
      border: 'rgba(28,28,24,0.08)',
      surface: '#F4F4F2',
      accentBg: '#FFF3E8',
    },
  },
  {
    id: 'bone',
    name: 'Bone',
    tokens: {
      paper: '#F6F5EF',
      text: '#1C1C18',
      muted: '#6B6B60',
      faint: '#ADADAA',
      border: 'rgba(28,28,24,0.12)',
      surface: '#EEEEE9',
      accentBg: '#FFF3E8',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    tokens: {
      // Re-toned 2026-05-14: previous palette was too warm/brown and the
      // muted/faint/border layers compressed into a single muddy band,
      // hurting readability of meta + bubble surfaces. New palette is
      // neutral-with-a-warm-hint (matches Spool's warm-not-cold rule
      // without the yellow cast), with deeper paper + brighter
      // muted/faint/border so the layers actually separate.
      paper: '#2B2B28',
      text: '#EAEAE3',
      muted: '#A8A8A0',
      faint: '#7A7A72',
      border: 'rgba(234,234,227,0.16)',
      surface: '#42423E',
      accentBg: '#2A1E0A',
    },
  },
  {
    id: 'ink',
    name: 'Ink',
    tokens: {
      paper: '#1A1A16',
      text: '#F2F2EC',
      muted: '#8A8A80',
      faint: '#505048',
      border: 'rgba(242,242,236,0.10)',
      surface: '#242420',
      accentBg: '#2A1800',
    },
  },
]

export function paperTokens(paper: Paper): PaperTokens {
  return (PAPERS.find((p) => p.id === paper) ?? PAPERS[0]!).tokens
}

/** Binary chrome mode for the Editor UI (separate from paper choice).
 *  Ink and Graphite are dark enough that the editor's surrounding
 *  chrome (top bar, banners, panel) should also flip to dark mode for
 *  visual coherence with the artifact. */
export function chromeMode(paper: Paper): 'light' | 'dark' {
  return paper === 'ink' || paper === 'graphite' ? 'dark' : 'light'
}

export interface TypefaceDef {
  id: Typeface
  name: string
  /** CSS font-family declaration applied to non-mono text in templates. */
  family: string
  /** Short label for preview swatches. */
  sample: string
}

export const TYPEFACES: TypefaceDef[] = [
  {
    id: 'inter',
    name: 'Inter',
    family: "'Inter Variable', 'Inter', system-ui, sans-serif",
    sample: 'Aa',
  },
  {
    id: 'geist',
    name: 'Geist',
    family: "'Geist Variable', 'Geist', system-ui, sans-serif",
    sample: 'Aa',
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    family: "'Fraunces Variable', 'Fraunces', 'Georgia', serif",
    sample: 'Aa',
  },
  {
    id: 'hanken-grotesk',
    name: 'Hanken Grotesk',
    family: "'Hanken Grotesk Variable', 'Hanken Grotesk', system-ui, sans-serif",
    sample: 'Aa',
  },
]

export function typefaceFamily(id: Typeface): string {
  return (TYPEFACES.find((t) => t.id === id) ?? TYPEFACES[0]!).family
}

export interface Colorway {
  id: 'amber' | 'walnut' | 'sage' | 'marine'
  name: string
  swatch: string
}

/** Per-draft overrides to the redact pipeline. Only effective when
 *  `redact: true` is also set.
 *
 *  • `kinds` — `SensitiveKind` (or synthetic `'synthetic:author'`
 *    / `'synthetic:manual'`) categories the user has opted out of
 *    (e.g. `'absolute-path'` when paths are part of the story).
 *    Persisted with the draft — these are policy strings, never
 *    value-bearing.
 *
 *  • `valueHashes` — FNV-1a 32-bit hex hashes of specific literal
 *    substrings the user has chosen NOT to redact. Persisted with
 *    the draft so per-item decisions survive reload. The literal
 *    itself is never written: at apply time we hash each detected
 *    value and check membership. See
 *    `hashValueForRedactExclude` in `@spool-lab/redact`.
 *
 *  • `values` — same idea as `valueHashes` but with literal strings.
 *    Provided for ergonomic/programmatic use (unit tests, in-memory
 *    composition); the Share editor host MUST NOT persist them.
 *    Both fields are honoured at apply time as a set union. */
export interface RedactExclude {
  kinds?: string[]
  valueHashes?: string[]
  values?: string[]
}

export interface EditorOpts {
  template: Template
  paper: Paper
  typeface: Typeface
  colorway: Colorway['id']
  accentHex: string
  density: Density
  redact: boolean
  redactExclude?: RedactExclude | undefined
  /** Indices of turns to include in the artifact. `undefined` means
   *  "include all turns" (the default). An empty array excludes
   *  everything — unusual but valid. */
  selected?: number[] | undefined
  /** When a selection is active, render a "⋯ N turns skipped" marker
   *  between non-adjacent kept turns so the excerpt doesn't
   *  misrepresent the original flow. */
  showGaps: boolean
  /** Top chrome — Spool wordmark and the template's section label
   *  (e.g. "§ A Transcript"). Turn off for a cleaner, title-first
   *  artifact. */
  showMasthead: boolean
  /** Bottom chrome — "Stitched on Spool" + page marker. Turn off for
   *  social-ready outputs where branding would read as clutter. */
  showColophon: boolean
  /** Skip turns whose body is empty or whitespace-only. Tool-only
   *  assistant turns (status updates, sub-conversation noise that
   *  upstream parsers couldn't drop) otherwise show up as bare role
   *  headers with no content. On by default; users can flip it off
   *  to expose every turn explicitly. */
  hideEmptyTurns: boolean
}

/** The on-disk .spool file format. Version-stamped for forward compat.
 *
 *  - v1 files have no `Turn.id`; `readSpoolFile` backfills via
 *    `ensureTurnIds` so downstream code always sees ids.
 *  - v2 files are written by the current `buildSpoolDocument`; turn
 *    ids are stable across reloads (see `ensureTurnIds`). */
export interface SpoolDocument {
  version: 1 | 2
  conversation: Conversation
  opts: EditorOpts
  exportedAt: string
}

/** Wire-format snapshot served by the share-backend reader endpoint.
 *  Mirrors `packages/app/src/shared/share-publish.ts` — kept here so the
 *  `spool.pro` web reader can depend on share-kit alone. The desktop
 *  publish IPC owns the editor-side authoritative copy; if the two ever
 *  drift, the backend's zod validator in
 *  `packages/share-backend/src/publish/validators.ts` is canonical. */
export type SnapshotTurnRole = 'user' | 'assistant' | 'system' | 'tool'

export interface SnapshotTurn {
  id: string
  role: SnapshotTurnRole
  content: string
  /** Informational — true when the publish-time redact pass rewrote
   *  this turn's body. Reader Phase A doesn't render anything for it;
   *  reserved for a future "[content was edited by author]" badge. */
  redacted?: boolean
}

export interface SnapshotEditorOpts {
  template: string
  paper: string
  typeface: string
  colorway: string
  density: 'compact' | 'relaxed'
  masthead: boolean
  colophon: boolean
  avatars: boolean
  show_byline: boolean
}

export interface Snapshot {
  schema_version: 1
  source: {
    kind: 'spool-session' | 'imported-file' | 'imported-jsonl'
    origin_hint?: string
    captured_at: string
  }
  conversation: {
    title: string
    turns: SnapshotTurn[]
    turn_order: string[]
    hidden_turns: string[]
  }
  editor_opts: SnapshotEditorOpts
}

/** Source-color dot palette, used by the SourceChip component. */
export const SOURCE_DOTS: Record<Platform, { light: string; dark: string }> = {
  ChatGPT: { light: '#10A37F', dark: '#20C38F' },
  Claude: { light: '#C26A4E', dark: '#E89A7C' },
  Gemini: { light: '#5887D0', dark: '#8AB0E5' },
}

export const TEMPLATES: { id: Template; name: string; blurb: string }[] = [
  { id: 'chat', name: 'Chat', blurb: 'Messenger bubbles, native-app feel.' },
  { id: 'letter', name: 'Letter', blurb: 'Single-column, reading-first.' },
  { id: 'forum', name: 'Forum', blurb: 'Threaded posts with avatars and post numbers.' },
  { id: 'timeline', name: 'Timeline', blurb: 'Rail of time with marker per turn.' },
]

export const COLORWAYS: Colorway[] = [
  // Order is warm → cool (amber → walnut → sage → marine) so the
  // picker reads as a structured palette rather than a hue jump.
  //
  // Every swatch is calibrated to relative luminance ≈ 0.18–0.22 so
  // accent vs paper contrast clears WCAG 3:1 on all four papers
  // (Snow / Bone / Graphite / Ink) — the floor for non-text graphical
  // accents (underline, dot, chip, link). Earlier picks (Moss
  // #4A6B3E, Iris #7E6BB5, Walnut #8E6843) dropped below 3:1 on the
  // dark papers and were retuned.
  { id: 'amber', name: 'Amber', swatch: '#C85A00' },
  { id: 'walnut', name: 'Walnut', swatch: '#9F7A4C' },
  { id: 'sage', name: 'Sage', swatch: '#688A55' },
  { id: 'marine', name: 'Marine', swatch: '#4A85B0' },
]

export const TEMPLATE_RATIO: Record<Template, { w: number; h: number }> = {
  forum: { w: 720, h: 960 },
  letter: { w: 720, h: 960 },
  timeline: { w: 720, h: 960 },
  chat: { w: 720, h: 960 },
}

export const DEFAULT_OPTS: EditorOpts = {
  template: 'chat',
  paper: 'snow',
  typeface: 'inter',
  colorway: 'amber',
  accentHex: '#C85A00',
  density: 'compact',
  redact: true,
  selected: undefined,
  showGaps: true,
  showMasthead: true,
  showColophon: true,
  hideEmptyTurns: true,
}

/** Fill in any missing fields on stored opts with defaults. We're
 *  pre-launch so no real legacy migration is needed yet — if the
 *  schema evolves in a breaking way post-launch, add mapping here.
 *  Unknown enum values are coerced to their defaults so a stale
 *  IndexedDB entry can't crash the UI. */
export function normalizeOpts(raw: unknown): EditorOpts {
  const merged = { ...DEFAULT_OPTS, ...((raw as Partial<EditorOpts>) ?? {}) }
  // redactExclude defaults to undefined. At normalise we honour
  // `kinds` (policy strings) and `valueHashes` (FNV hex hashes —
  // not the literals). Any `values` field found in a stored draft
  // is silently dropped: persisting literal exclusion strings would
  // duplicate the very secrets we're trying to hide. Tests and
  // in-memory composition may still pass `values` to
  // `applyRedactPolicy`; the load path just refuses to keep them.
  if (merged.redactExclude) {
    const re = merged.redactExclude
    merged.redactExclude = {
      kinds: Array.isArray(re.kinds) ? re.kinds.filter((k): k is string => typeof k === 'string') : [],
      valueHashes: Array.isArray(re.valueHashes)
        ? re.valueHashes.filter((h): h is string => typeof h === 'string')
        : [],
    }
  }
  if (!TEMPLATES.some((t) => t.id === merged.template)) {
    merged.template = DEFAULT_OPTS.template
  }
  if (!PAPERS.some((p) => p.id === merged.paper)) {
    merged.paper = DEFAULT_OPTS.paper
  }
  if (!TYPEFACES.some((t) => t.id === merged.typeface)) {
    merged.typeface = DEFAULT_OPTS.typeface
  }
  // A legacy snapshot can still carry a since-retired colorway id
  // (e.g. 'ink' from pre-#207, 'moss' / 'iris' from the pre-readability
  // palette). Coerce to the default + reset accentHex so the picker
  // shows a valid current selection and the rendered accent doesn't
  // keep a stale swatch.
  const colorway = COLORWAYS.find((c) => c.id === merged.colorway)
  if (!colorway) {
    merged.colorway = DEFAULT_OPTS.colorway
    merged.accentHex = DEFAULT_OPTS.accentHex
  }
  return merged
}
