# Capture

How to record the Spool Electron app as a native macOS window. Output is a `.mov` per feature, used as the source for each scene in the composition.

## Why native window, not Playwright screenshots

Playwright's `page.screenshot()` and `video` recording only capture the WebContents — no traffic lights, no rounded corners, no shadow. The composition shows the window-on-stage, so we need the real OS window.

Solution: capture the rectangular region the macOS window occupies via `screencapture -R`. Use a Swift one-liner to find the Quartz window id matching the Electron process pid + bounds.

## Helper functions (already in `packages/app/e2e/helpers/`)

- `nativeWindowInfo(app)` — returns `{id, x, y, width, height}` for the front-most Electron BrowserWindow.
- `captureNativeWindow(app, path)` — single PNG (uses `screencapture -l <id>`).
- `recordNativeWindow(app, path, seconds, perform)` — runs `screencapture -V <seconds> -R <rect>` while `perform()` drives the app concurrently.
- `launchDemoApp(seed)` + `setDemoWindowBounds(ctx, 1080, 740)` — boot Electron with programmatic fixtures, force dark, set canonical size.
- `installCursorOverlay(window)` — inject the synthetic DOM cursor that tracks Playwright's `mouse.move()` and pulses on `mousedown`. Call once after `waitForDemoSync(window)`; see `cursor-overlay.md` for details.
- `cursorTo(window, selector, opts)` / `cursorClick(window, selector, opts)` / `cursorPark(window, x, y)` — replace bare `.click()` so the cursor's path is visibly filmed.
- `emitUpdateStatus(app, payload)` — push updater banner state via IPC.
- `pinFirstRowInProject(window, name)` — hover + pin first session row.

## Authoring the per-release seed

Each release demos different features → different sidebar content.

Build a `ProjectSeed[]` (type in `packages/app/e2e/helpers/demo-fixtures.ts`):

```ts
import type { ProjectSeed } from '../e2e/helpers/demo-fixtures'

const PROJECTS: ProjectSeed[] = [
  {
    name: 'spool',
    total: 79,
    leadSessions: [
      { title: 'Audit the share flow in a fresh worktree', source: 'claude', iso: '2026-05-13T15:12:00Z' },
      // ... more titles per project
    ],
    fillerSources: ['claude', 'codex'],
  },
  // ... more projects
]
```

**Rules for seed data:**

- English-only titles
- **Must not reference real user sessions** — invent plausible titles thematically relevant to the release (e.g. for a security release, sessions describing the kind of work where the leaked secret might plausibly have been pasted into the chat).
- 10–15 projects total feels right in the sidebar.
- One project's `total` should be high (≥ 70) to demo the count badge.
- Mix `source` between `claude` and `codex` so the badges look varied.

## Writing the ad-hoc capture spec

The capture spec is **per-release, not committed**. Put it at `packages/app/e2e/release-capture.spec.ts` and gitignore-add it (or just delete after the release ships).

Structure:

```ts
import { test } from '@playwright/test'
import { launchDemoApp, setDemoWindowBounds, waitForDemoSync } from './helpers/demo-launch'
import { recordNativeWindow } from './helpers/native-window-capture'
import { installCursorOverlay, cursorClick, cursorPark } from './helpers/cursor-overlay'
import { emitUpdateStatus, pinFirstRowInProject } from './helpers/demo-interactions'

const PROJECTS = [/* per-release seed */]

const OUT_DIR = path.join(__dirname, '../../../videos/spool-vX.Y.Z/assets/live')

test('record release clips', async () => {
  test.setTimeout(540_000)  // ~9min — relaxed pacing across 7 beats can take longer than the default 30s test timeout

  const ctx = await launchDemoApp(PROJECTS)
  await setDemoWindowBounds(ctx, 1080, 740)
  await waitForDemoSync(ctx.window)
  await installCursorOverlay(ctx.window)         // synthetic cursor for the rest of the spec
  await cursorPark(ctx.window, 120, 360)          // park off to the side before clip 1

  await recordNativeWindow(ctx.app, path.join(OUT_DIR, '01-home.mov'), 4.0, async () => {
    await ctx.window.waitForTimeout(500)         // settle so the cursor is in the first filmed frame
    await cursorClick(ctx.window, '[data-testid="<feature-gated-element>"]', {
      preClickPause: 260, postClickPause: 280,
    })
    // ... drive the rest of the scene
  })

  // ... more clips per feature

  await ctx.cleanup()
})
```

Run with:

```bash
pnpm --filter @spool/app exec playwright test e2e/release-capture.spec.ts \
  --workers=1 --global-timeout=900000 --retries=0
```

`--global-timeout` is required for relaxed-pacing releases — Playwright's config default is 300s and a 7-beat spec with relaxed `postClickPause` values can easily exceed that. `--retries=0` because a flaky capture (Electron failing to focus, screencapture permission glitch) on first run can spawn a second Electron whose window overlaps the first — the capture then records the wrong app state. Better to fail loudly and re-run by hand than auto-retry and ship wrong frames.

If the feature being demoed is behind a build-time flag (e.g. `VITE_FEATURE_<NAME>`), build the app with the flag *before* running the spec — `import.meta.env.VITE_FEATURE_<NAME>` is inlined at build time:

```bash
VITE_FEATURE_<NAME>=1 pnpm --filter @spool/app run build:electron
```

If the feature is also gated by a runtime opt-in stored in `agents.json` (e.g. a Labs toggle), seed it via `launchDemoApp(..., { agentsConfig: { <flag>: true } })` so the main process reads it at boot.

## Capture-time constants

| | Value | Why |
|---|---|---|
| Window logical size | 1080×740 | Matches app default (`packages/app/src/main/index.ts`); the composition assumes this aspect |
| Theme | dark forced | `nativeTheme.themeSource = 'dark'` in `setDemoWindowBounds()` |
| GPU | disabled | `ELECTRON_DISABLE_GPU=1` for deterministic frames |
| `screencapture` cursor | off | Default; don't add `-C`. The real OS cursor doesn't move with Playwright, so capturing it would film a stationary system arrow in some corner. Use the synthetic DOM cursor from `cursor-overlay.md` instead |

## Common capture issues

- **Window not found.** `screencapture -R` failures usually mean the Electron window hasn't focused. Call `app.focus({steal: true})` + `win.focus()` before recording.
- **Playwright `mouse.click()` does NOT move the OS cursor.** It dispatches DOM events directly. If you need cursor-in-frame, install the synthetic DOM cursor from `cursor-overlay.md` — a real cursor that tracks Playwright input + a click pulse. Don't try to drive `cliclick` to move the real OS cursor; the timing is fiddly and the result still looks unnatural.
- **First-frame black pixels in the output `.mov`.** `screencapture -V` has ~21ms latency before the first frame lands. Padded out at composition time via `tpad` (see `poster.md`).
- **Timing slips between perform() and screencapture.** `recordNativeWindow` starts the recording, then runs `perform()`. There's a ~500ms lead-in where you can `waitForTimeout` to settle before the first action.
- **Captures show test-suite fixtures instead of demo seed.** Symptom: clip 1 records the wrong Electron window's content (e.g. test-project fixtures with XYLOPHONE_CANARY data). Cause: a previous test left an Electron process running and Playwright auto-retried after a flake, spawning a second Electron whose Quartz window-id won the `nativeWindowInfo()` match. Fix: `pkill -9 -f Electron` before the spec, and run with `--retries=0` so flakes don't silently double up.
- **Build-time feature flag not applied.** Symptom: test fails to find a feature-gated selector (e.g. `[data-testid="<feature-gated-element>"]`) even though the smoke test passes for unrelated selectors. Cause: built the app without `VITE_FEATURE_<NAME>=1`. Vite inlines `import.meta.env.VITE_FEATURE_<NAME>` at build time, not runtime, so setting the env var when running playwright is too late. Rebuild with the flag.
