## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, layout, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules at a glance:

- Public web is content-first: show real Sessions and authors before feature explanations
- `Share` explicitly sends records; supported Claude/Codex Shares are Public by default, while unsupported providers remain Link-only
- Public metadata is author-attributed (`@handle · published 2h ago`), never first-person
- Paperboy electric blue accent `#1387FF` (light) / `#5BB1F0` (dark) is the sole product accent; amber is reserved for warning semantics
- Void palette: `#000000` background with `#090909` surfaces in dark mode; white with neutral-gray surfaces in light mode
- Geist Sans for UI chrome; Geist Mono for Session records, commands, URLs, and paths
- Session pages separate interpretive Summary from machine-derived evidence
- Visibility and continuation lineage must remain explicit trust signals
- `Team · {name}` is a real tenant boundary: current members only, `private, no-store`, and never included in public Profile, Explore, search, RSS, previews, or OG metadata
- Emoji are placeholder icons only — production UI uses Lucide React SVGs
- "via ACP · local" remains mandatory wherever local AI synthesis appears

In QA mode, flag any code that doesn't match DESIGN.md.

## Test discipline

Every bug fix and feature PR must:

1. **Add tests for the change.** Bug fix → a regression test that fails on the pre-fix code. Feature → primary path + non-obvious edges (empty / error / boundary). Web UI changes use focused component and route tests under `apps/web`; pure logic uses vitest under `{apps,packages}/*/src/**.test.ts`.
2. **Run the adjacent suite, not just the new tests, before declaring done.** Changes ripple: virtualization breaks DOM-count assertions, selector renames break old e2e, fixture changes shift sort order. Fix any cascading failures in the same PR — never ship a regression with a TODO.
3. **Don't fight flakiness.** A flake is a test that's lying. Diagnose root cause once; if it can't be made reliable without fighting the framework, drop it and document the coverage gap in the PR body rather than papering over with `--repeat-each`.

Completion checklist: typecheck clean → new tests green → adjacent suite green → flaky candidates stress-run 2–3× → only then declare done.
