## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, layout, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules at a glance:

- Public web is content-first: show real Sessions and authors before feature explanations
- Product navigation is `Sessions`, `My Sessions`, and `Teams`; the wordmark alone returns home, while `Docs` sits with legal/resource links
- Explore exposes only honest global `Top` and chronological `Recent` orders; never label the global ranking `For you`
- `Share` publishes supported Sessions as Public by default; providers not yet supported by Explore remain Link-only
- Public metadata is author-attributed (`@handle · published 2h ago`), never first-person
- Paperboy electric blue accent `#1387FF` (light) / `#5BB1F0` (dark) is the sole product accent; amber is reserved for warning semantics, never primary branding
- Void palette: `#000000` background with `#090909` surfaces in dark mode; white with neutral-gray surfaces in light mode
- The homepage may use the approved WebGL knowledge-space hero and share → server → resume animation; product and reading surfaces keep motion minimal and functional
- Geist Sans for UI chrome; Geist Mono for Session records, commands, URLs, and paths
- Session pages separate interpretive Summary from machine-derived evidence
- Visibility and continuation lineage must remain explicit trust signals
- `Team · {name}` is a real tenant boundary: current members only, `private, no-store`, and never included in public Profile, Explore, search, RSS, previews, or OG metadata
- Team workspaces default to a newest-first Session activity feed, with membership and settings kept in their dedicated sections
- Emoji are placeholder icons only — production UI uses Lucide React SVGs
- "via ACP · local" remains mandatory wherever local AI synthesis appears

In QA mode, flag any code that doesn't match DESIGN.md.

Do not run E2E tests during local development unless the user explicitly asks; they are too slow.
