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
- Result metadata is first-person: "You discussed this" not "Claude Code · Mar 15"
- "via ACP · local" label always shown on AI-mode answers — non-negotiable trust signal

In QA mode, flag any code that doesn't match DESIGN.md.

## Test discipline

Every bug fix and feature PR must:

1. **Add tests for the change.** Bug fix → a regression test that fails on the pre-fix code. Feature → primary path + non-obvious edges (empty / error / boundary). UI changes use Playwright e2e under `apps/app/e2e/`; pure logic uses vitest under `{apps,packages}/*/src/**.test.ts`.
2. **Run the adjacent suite, not just the new tests, before declaring done.** Changes ripple: virtualization breaks DOM-count assertions, selector renames break old e2e, fixture changes shift sort order. Fix any cascading failures in the same PR — never ship a regression with a TODO.
3. **Don't fight flakiness.** A flake is a test that's lying. Diagnose root cause once; if it can't be made reliable without fighting the framework, drop it and document the coverage gap in the PR body rather than papering over with `--repeat-each`.

Completion checklist: typecheck clean → new tests green → adjacent suite green → flaky candidates stress-run 2–3× → only then declare done.

## Release videos

When asked to make a launch / release / announcement video for Spool,
invoke the `launch-video` skill. It covers the capture pipeline, the
HyperFrames composition layout, common pitfalls, and the social-media
poster trick.

- Capture primitives live in `apps/app/e2e/helpers/`
  (`native-window-capture.ts`, `demo-fixtures.ts`, `demo-launch.ts`,
  `demo-interactions.ts`).
- The composition skeleton lives at `videos/launch-template/`.
- Per-release assets (raw `.mov`, audio, renders) are gitignored —
  source of truth is the composition `index.html` plus the helpers.

