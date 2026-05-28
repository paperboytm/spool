---
name: launch-video
description: Use when creating a launch, release, or announcement video for the Spool desktop app from real screen recordings. Covers the capture pipeline (Electron + native macOS window recording), the HyperFrames composition layout, common trailer-vs-PPT pitfalls, and the first-frame poster trick for social media. Invoke when the user mentions release video, launch video, announcement video, trailer, demo video, or wants to ship a video for a Spool version bump.
user-invocable: true
argument-hint: "[version (e.g. v0.5.0)]"
---

Build a release video for a Spool version. The output is a 1080p MP4 plus a poster JPG, intended for X / Twitter. Runtime scales with feature count: 20–40s, 3–8 feature beats + brand outro, optionally a stylised capstone scene before the outro for releases whose payoff is a tangible outcome the captured clips can't show on their own.

## Mental model

A release video for Spool has two halves running in parallel on screen:

1. **Left third** — a text panel that introduces the current scene (kicker `01 / 04 — POLISH`, a 2-line headline, a 1–2 line sub).
2. **Right two-thirds** — the real Spool app, recorded as a native macOS window. The camera (CSS `transform-origin + scale` on the `.window`) zooms into the specific UI region for each feature.

Focus on the active feature is carried by one of two devices:
- **Amber annotation rectangles** inside `.window` that track the camera — good for "look at this strip" callouts. Cheap and precise when the feature is a single bounded region.
- **Spotlight mask** — an SVG overlay that dims everything except 1–2 transparent "holes" punched through. Softer falloff means small coordinate drift disappears into the dim instead of reading as a misaligned outline. Dual holes let you keep the preview bright while a control on the right side lights up in sync with a click. See `references/spotlight.md`.

This is **not** a PPT: text panel and demo coexist continuously, with hard match-cuts between feature clips. Don't reintroduce slide-style title cards.

## Required preparation

Read these references before you start composing. They are not optional — each captures hard-won decisions from prior releases.

- `references/composition.md` — the proven layout, dimensions, drop-shadow recipe, panel + annotation timing patterns, beat-sync approach, the panel-leads-spotlight rhythm rule, the optional capstone scene
- `references/capture.md` — how to record native macOS windows of the Electron app, helper functions to use, per-release seed authoring, the feature-flag-at-build-time gotcha
- `references/cursor-overlay.md` — synthetic cursor that tracks Playwright mouse + visualises clicks. Solves "Playwright doesn't move the OS cursor and screencapture only films pixels"; required whenever a scene's whole point is a click
- `references/spotlight.md` — SVG-mask focus technique; single-hole for one target, dual-hole for cause-effect (preview always bright + active control bright); the payoff pattern (collapse secondary to redirect the eye)
- `references/pitfalls.md` — things we tried that look bad in motion (decorative chrome, smooth camera drifts, pre-clip resets, clip-boundary gaps, etc.) and why
- `references/poster.md` — the `tpad clone` trick so Twitter's auto-thumbnail grabs the hero frame instead of a leading black frame

## End-to-end checklist

1. **Inventory the features to demo.** A release video shows 3–4 features max. Pick the ones with the most visible UI change.
2. **Author a per-release seed.** Write a `ProjectSeed[]` array (see `packages/app/e2e/helpers/demo-fixtures.ts` for the type). Titles should be English-only and **must not reference real user sessions** — invent plausible session titles relevant to the release theme.
3. **Write an ad-hoc capture spec.** A Playwright spec under `packages/app/e2e/` (not committed) that:
   - Calls `launchDemoApp(seed)` + `setDemoWindowBounds(ctx, 1080, 740)`
   - Calls `installCursorOverlay(ctx.window)` (from `helpers/cursor-overlay.ts`) before any clip is recorded so the synthetic cursor is in frame from t=0
   - Records one `.mov` per feature via `recordNativeWindow()` from `helpers/native-window-capture.ts`
   - Uses `cursorClick(window, selector, opts)` / `cursorTo(...)` / `cursorPark(x, y)` from the same helper instead of bare `.click()` so the cursor's path is visibly filmed
   - Outputs to `videos/spool-vX.Y.Z/assets/live/` (gitignored)
   - If your release gates a feature behind a Vite flag, build the app with `VITE_FEATURE_<NAME>=1 pnpm --filter @spool/app run build:electron` *before* running the spec — `import.meta.env.VITE_FEATURE_<NAME>` is inlined at build time, not read at runtime
   - Bump `--global-timeout` if pacing is relaxed: Playwright's default 300s isn't enough for 7-beat spec runs (~50s of `screencapture -V` plus warmup)
4. **Copy `videos/launch-template/` to `videos/spool-vX.Y.Z/`.**
5. **Customise the composition** (`index.html`):
   - Update `<video>` `data-start`, `data-duration`, `src` per clip. Verify each pair satisfies `prev.data_start + prev.data_duration ≥ next.data_start + 0.10` — gaps where neither clip is playing render as a dark frame and read as a full-screen flash (see `pitfalls.md` #11)
   - Author one text panel per scene (kicker + headline + sub)
   - **Measure focus-region coords fresh** from your raw `.mov` frames — last release's coords are wrong for this release
   - Time the panel `~0.3–0.4s ahead of the spotlight retarget` so the headline anchors before the action starts (see `composition.md` on panel-leads-spotlight)
   - Update the brand-mark version + outro version strings
6. **Drop in BGM** at `assets/bgm.mp3`. Identify strong beats with `ffmpeg silencedetect` (for tracks with clear silences) OR `aubiotrack` (more reliable for steady-state atmospheric pieces); align scene cuts or camera punches to them. If your video needs to be longer than the source BGM, stretch with `atempo` — 0.85 is the comfortable floor (subtle pitch drop, no audible quality loss), 0.79 still acceptable, below 0.75 starts to degrade. Add a 0.6–0.8s `afade=t=out` tail so the music decays into the lockup instead of cutting off.
7. **Iterate with drafts.**
   ```
   cd videos/spool-vX.Y.Z
   npm run check     # lint + validate + inspect
   npm run render -- --quality draft --output renders/draft.mp4
   ```
   Pull frames at scene boundaries to verify before re-rendering.
8. **Render standard quality.**
   ```
   npm run render -- --quality standard --output renders/spool-vX.Y.Z-raw.mp4
   ```
9. **Patch the first frame** for social media (see `references/poster.md`). The output of this step is the file you upload to X.
10. **Extract a poster JPG** for tweet thumbnail fallback / preview imagery.

## Hard rules

- **Synthetic cursor is allowed but must track real input.** A floating GSAP cursor that arrives at random places looks uncanny — that rule from prior releases stands. What's *not* uncanny is the cursor-overlay technique in `references/cursor-overlay.md`: a DOM cursor injected into the page that follows Playwright's actual `mouse.move()` and pulses on `mousedown`. If a scene's whole point is a click, draw the cursor. Don't draw a cursor for scenes where nothing's being clicked.
- **Chain state across clips. Don't reset between recordings.** If clip N ends with the UI in some configuration, clip N+1 starts there. Pre-clip state resets (clicking around to clean up between recordings) cause a visible "flash" at the clipCut boundary even though both clips show valid app pixels. If a later beat needs a specific look, get to it *inside* an earlier recording (the user sees the click) or design the demo flow so the natural state at each beat is already what you want.
- **First frame must be the full hero state.** Brand mark + panel 1 + UI window all visible at `t=0`, not faded in. Twitter's auto-thumbnail grabs this frame.
- **Annotations and spotlights live inside `.window`**, not on the outer canvas. They must move with the camera transform.
- **Spotlight coords must be verified by overlay on the rendered frame.** Eyeballing them off a grid on a raw `.mov` is consistently 5–15% off. See `pitfalls.md` on the drawbox verification loop.
- **No decorative chrome.** No vignette, callsign, progress bar, or trailer-style overlay flashes. The UI is the protagonist.
- **No "pull back to neutral" before the outro.** End the last feature beat on its focus, then hard-cut/fade to the Spool lockup (or to the capstone scene if the release earns one).

## Files this skill touches

- Reads: `packages/app/e2e/helpers/{demo-fixtures,demo-launch,demo-interactions,native-window-capture,cursor-overlay}.ts`
- Reads: `videos/launch-template/`
- Creates: `videos/spool-vX.Y.Z/` (new release directory)
- Creates: a temporary Playwright spec under `packages/app/e2e/` (do not commit; delete or gitignore after the release ships)
- Outputs: `videos/spool-vX.Y.Z/renders/spool-vX.Y.Z-final.mp4` and `.jpg` poster (both gitignored)
