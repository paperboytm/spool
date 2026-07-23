# `@spool-lab/ui`

Shared browser-safe React chrome for Spool Web. The package implements the compact component and
token contract in `docs/ui-architecture.md`; it contains no routing, application state,
localization, or Session-domain behavior. The retired Electron source remains an archived
reference, not a maintained consumer.

## Usage

Import the full primitive stylesheet once at an application root:

```tsx
import '@spool-lab/ui/styles.css'

import { Badge, Button, ListRow } from '@spool-lab/ui'

export function SessionResult() {
  return (
    <ListRow
      attribution="@handle · published 2h ago"
      title="A public Session"
      summary="The author shipped a focused result."
      metadata={<Badge variant="source-codex">Codex CLI</Badge>}
      trailing={<Button variant="outline">Resume</Button>}
    />
  )
}
```

Surfaces that only need the shared variables can instead import `@spool-lab/ui/tokens.css`.
Consumers provide Geist Sans and Geist Mono; this package deliberately does not fetch fonts or
install a global reset. Both `html.dark` and `html[data-theme='dark']` activate the dark palette.

`className` is available on every primitive for layout placement. Component height, typography,
radius, internal padding, and color changes belong in the variant props or in this package—not in
consumer overrides.

## Components

- `Button` / `ButtonLink`: `ghost`, `outline`, `accent`, or `danger`; `sm`, `md`, or `lg`.
  `Button` also exposes a distinct accessible loading state.
- `IconButton` / `IconLink`: `sm` or `md`, with a required `aria-label`.
- `MobileMenu`: a zero-configuration 44px disclosure trigger with Escape and outside-click closing.
- `SearchField`: controlled value and change handler, plus an optional clear callback.
- `Tabs`: controlled string value and accessible tab items.
- `NavItem`: renders an anchor when `href` is supplied and a button otherwise.
- `Badge`, `Avatar`, `SectionLabel`, `ListRow`, and `Wordmark` provide the shared content chrome.
- `cx` composes conditional class values without another runtime dependency.

## Development

```sh
pnpm --filter @spool-lab/ui typecheck
pnpm --filter @spool-lab/ui test
vp run --filter @spool-lab/ui build
```
