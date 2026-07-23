# Shared UI architecture

`@spool-lab/ui` is the executable visual-system seam for Spool Web. `DESIGN.md` remains the
product-level source of truth; this package turns its recurring chrome rules into one interface so
individual Web surfaces cannot invent their own button, input, tab, navigation, badge, avatar, and
list-row scales.

> The Electron source under `apps/app` is a frozen implementation reference. It is excluded from
> the workspace and all automation; Desktop notes below document historical decisions rather than
> an active migration or verification target.

## Goals

- Web application surfaces use the same components and compact density.
- Marketing content may keep editorial display typography and section spacing, but its navigation,
  buttons, inputs, badges, avatars, and public Session rows use the shared primitives.
- One token file owns color, typography, control dimensions, spacing, radius, and motion values.
- Theme adapters retain both the historical `.dark` root and Web's `html[data-theme='dark']`
  attribute so the archived implementation remains legible.
- Consumers may control layout and content, not restyle primitive dimensions per page.

## Package interface

The package exports:

- `Button`, `ButtonLink`: `ghost | outline | accent`; `sm | md`.
- `IconButton`, `IconLink`: accessible-label required; `sm | md`.
- `SearchField`: controlled input with leading icon and optional clear action.
- `Tabs`: accessible tab list with controlled string value.
- `NavItem`: link or button with leading/trailing slots and active state.
- `Badge`: `neutral | accent | source-claude | source-codex | success | warning | error`.
- `Avatar`: image with resilient initials fallback.
- `SectionLabel`: compact uppercase label with optional count/action.
- `ListRow`: shared Session/result row layout with leading, attribution, title, Summary, metadata,
  lineage, and trailing slots. Callers retain routing/domain behavior.
- `Wordmark`.
- `cx` for compact conditional class composition.
- `@spool-lab/ui/styles.css`: tokens and primitive implementation.
- `@spool-lab/ui/tokens.css`: tokens only for surfaces that cannot yet adopt components.

Every component accepts `className` for layout placement only. Variant props are the interface for
visual changes; consumers must not override font size, control height, radius, or internal padding.
The package has no router, state-management, localization, or agent-domain dependency.

## Canonical compact scale

| Role                  | Value                                           |
| --------------------- | ----------------------------------------------- |
| UI body               | 13px Geist Sans                                 |
| Button                | 12px / 500                                      |
| Metadata              | 11px Geist Sans or Geist Mono                   |
| Label                 | 10px / 600 / 0.08em uppercase                   |
| Public Session title  | 15px / 600                                      |
| Small / medium button | 28px / 32px high                                |
| Icon button           | 24px / 32px square                              |
| Search field          | 36px high                                       |
| Tab                   | 36px high                                       |
| Nav item              | 32px minimum height                             |
| List row              | 20px horizontal / 12px vertical padding         |
| Internal gaps         | 6px / 8px / 12px                                |
| Radius                | badge 4px; row/button 6px; input 8px; card 10px |
| Hover transition      | 80ms                                            |

Touch adaptations may increase hit targets to 44px inside coarse-pointer/mobile media queries, but
must not inflate desktop typography or visual chrome.

## Fonts

Geist Sans is canonical for all chrome; Geist Mono is canonical for counts, commands, paths, URLs,
and evidence. Desktop's current `Inter Variable` Tailwind alias is drift from `DESIGN.md` and must
be changed to Geist while adopting the package. Decorative/editor-only typefaces remain local to
the Share editor and must not become chrome defaults.

## Tokens

Tokens use the `--sp-*` prefix. The package owns:

- light/dark warm palette and semantic/source colors;
- `--sp-font-sans`, `--sp-font-mono`;
- compact type sizes;
- control dimensions;
- spacing/radius/motion primitives.

Legacy aliases in Desktop/Web may temporarily point at `--sp-*` values during migration. New code
must consume `--sp-*` or shared components directly. Duplicated literal palettes should be removed
once a surface migrates.

## Migration ownership

### Legacy Desktop reference

- No new migration work is planned.
- Existing source may be consulted for local Session, rendering, and interaction patterns.
- Do not add product behavior or restore build/test/package automation without an explicit product
  decision that also updates `DESIGN.md`.

### Web

- Import shared tokens once at the root.
- Explore must use shared Wordmark/NavItem/SearchField/Tabs/Button/IconButton/Avatar/ListRow/Badge.
- Shared `Chrome`, Profile/Me controls, Reader actions, and marketing header/CTAs adopt the same
  primitives.
- Marketing hero/display typography remains editorial, but no marketing-only button/input/nav
  implementation remains.
- Remove duplicated control sizing and palette declarations from `explore.css`, `global.css`, and
  `app.css` as each area migrates.

## Verification

- Package component tests assert semantic element/ARIA/variant behavior.
- A CSS contract test asserts the canonical compact dimensions and theme selectors.
- Web typechecks and focused unit suites must pass.
- Web production build must pass.
- No E2E tests are run during local development.
- Visual QA checks the relevant Web route at desktop width, then checks the responsive collapse
  separately.
