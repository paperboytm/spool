# @spool/share-kit

Internal React library for curated Spool publication documents and export surfaces.

The Web reader uses these primitives to present selected turns with consistent typography,
redaction, and provenance. The browser-safe document and export boundaries remain available to Web
publication flows.

## Responsibilities

| Layer     | Exports                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| Domain    | `Conversation`, `Turn`, `EditorOpts`, `SpoolDocument`, template and color registries |
| Rendering | `TemplateRender`, `Forum`, `Letter`, `Timeline`, `Chat`, `Body`, `GapMarker`         |
| Reading   | Public document reader, progressive turn helpers, and document decoding              |
| Export    | PNG, PDF, Markdown, and `.spool` file helpers                                        |
| Drafts    | IndexedDB draft persistence for browser hosts                                        |
| Import    | Public conversation URL detection and content fetching                               |
| Safety    | Sensitive-span detection and configurable redaction                                  |
| Chrome    | `Wordmark`, `SourceMark`, and icon primitives                                        |

The package is host-agnostic: it owns no routing, account state, IPC, or assembled editor page.

## Usage

```tsx
import { DEFAULT_OPTS, FIXTURE_PASTED, TemplateRender } from '@spool/share-kit'
import '@spool/share-kit/styles.css'

export function Preview() {
  return <TemplateRender template="timeline" convo={FIXTURE_PASTED} opts={DEFAULT_OPTS} />
}
```

The styles entry expects a Tailwind v4 and Fontsource-aware Vite build.

## Document Boundary

A `.spool` document is a curated presentation artifact. It may select turns, apply redaction, and choose typography, but it does not replace the original provider Session. Authoritative records, sequence verification, and composed Session diff live in `@spool-lab/session-kit`.

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm build
```
