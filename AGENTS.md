## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, layout, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules at a glance:

- Search bar is centered on home screen (Google homepage feel), moves to top on results
- Warm amber accent `#C85A00` (light) / `#F07020` (dark) — never blue or purple
- Warm near-black `#141410` for dark mode — never pure `#000` or cold `#0A0A0A`
- Geist Sans for all UI chrome; Geist Mono for indexed content (fragments, URLs, paths)
- Emoji are placeholder icons only — production UI uses Lucide React SVGs
- Result metadata is first-person: "You discussed this" not "Codex · Mar 15"
- "via ACP · local" label always shown on AI-mode answers — non-negotiable trust signal

In QA mode, flag any code that doesn't match DESIGN.md.
