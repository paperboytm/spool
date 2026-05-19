# @spool/share-kit

Internal React library that powers Spool Share — the editor surface for turning AI conversations into PNG / PDF / `.spool` artifacts (Phase 0) and, eventually, hosted permalinks (Phase 2).

Consumed by:
- `@spool/app` — Electron renderer assembles its own three-column editor on top of these primitives
- `@spool/share-web` (Phase 1) — the public spool.pro web app uses the same primitives

## What's in the box

| Layer | Exports |
|---|---|
| Types | `Conversation`, `Turn`, `EditorOpts`, `Template`, `Paper`, `Typeface`, `Colorway`, `SpoolDocument`, `Origin`, …registries `PAPERS` / `TYPEFACES` / `TEMPLATES` / `COLORWAYS`, `DEFAULT_OPTS`, `normalizeOpts` |
| Templates | `TemplateRender` (dispatches by `template` id) + individual exports `Atelier`, `Letter`, `Transcript`, `Interview`, `Chat` |
| Template primitives | `Body` (markdown renderer with redact-chip support), `GapMarker` |
| Components | `Wordmark`, `SourceMark`, `Icons` namespace |
| Local exporters | `exportArtifact({ format: 'png' \| 'pdf', node, template, conversation })`, `saveBlob`, `buildSpoolDocument`, `downloadSpoolFile`, `readSpoolFile` |
| Parsers | `parseShareUrl`, `detectPlatform`, `ParseError`, `fetchContent` (Jina-based) |
| Drafts (IndexedDB) | `saveDraft`, `loadDraft`, `listDrafts`, `deleteDraft`, `draftIdFor` — used by spool.pro web; the Spool app uses its own SQLite-backed store |
| Sensitive-data | `detectSensitiveSpans(text)` → matches across email / phone / API key / JWT / absolute path / env var |

## Usage

```tsx
import { TemplateRender, DEFAULT_OPTS, FIXTURE_PASTED } from '@spool/share-kit'
import '@spool/share-kit/styles.css'

export function PreviewExample() {
  return <TemplateRender template="atelier" convo={FIXTURE_PASTED} opts={DEFAULT_OPTS} />
}
```

The styles entry expects a Tailwind v4 + Fontsource-aware bundler (Vite with `@tailwindcss/vite`, which both `@spool/app` and `@spool/share-web` already configure).

## Scripts

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # vite build (lib mode) → dist/index.js + dist/index.d.ts
```

## Phase 0 scope

This package intentionally does **not** ship an assembled editor UI. The wouter-routed three-column layout from the old `quilt` demo project was not ported because it bakes in host-specific concerns (routing, session-storage handoff, new-draft dialog). The Spool app and spool.pro web build their own editor pages composed of these primitives.

Markdown import and export were also dropped: MD cannot faithfully carry tool calls, redaction overlays, or audit chips, and reverse-parsing turn ownership is ambiguous. Revisit if real demand surfaces.
