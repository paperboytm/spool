## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, layout, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules at a glance:

- Public web is content-first: show real Sessions and authors before feature explanations
- `Share` creates a Link-only URL; `Publish` is the separate, explicit Public action
- Public metadata is author-attributed (`@handle · published 2h ago`), never first-person
- Warm amber accent `#C85A00` (light) / `#F07020` (dark) — never blue or purple
- Warm near-black `#141410` for dark mode — never pure `#000` or cold `#0A0A0A`
- Geist Sans for UI chrome; Geist Mono for Session records, commands, URLs, and paths
- Session pages separate interpretive Summary from machine-derived evidence
- Visibility and continuation lineage must remain explicit trust signals
- Emoji are placeholder icons only — production UI uses Lucide React SVGs
- "via ACP · local" remains mandatory wherever local AI synthesis appears

In QA mode, flag any code that doesn't match DESIGN.md.

Do not run E2E tests during local development unless the user explicitly asks; they are too slow.
