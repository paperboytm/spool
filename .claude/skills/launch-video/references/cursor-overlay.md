# Cursor overlay

A synthetic DOM cursor that tracks Playwright's mouse position and pulses on click. Required for scenes whose whole point is a click.

## Why it's needed

Two facts about the capture pipeline:

1. **Playwright's `page.mouse.move()` / `mouse.click()` don't move the OS cursor.** They dispatch DOM events directly into the renderer. The real OS cursor stays where it was when you ran the spec.
2. **`screencapture -V` films native pixels.** Whatever the OS shows is what ends up in the `.mov`. Even with `-C`, only the *real* OS cursor would be captured, and it's not moving.

So a scene like "click the + button, watch the picker open" reads as "the picker just appeared on its own" — no agency, no cause. The viewer doesn't see the click happen.

An earlier approach deleted the cursor entirely and used amber annotations to call out the *result* of the action. That works for changes that are visible at scale, but it falls apart when:

- The same UI region keeps appearing with different contents (a list cycling through options)
- The click is on a tiny target (a + button, a tab, a row affordance that fades in on hover)
- There are multiple consecutive clicks the viewer needs to follow

The cursor-overlay technique fixes this. The trick is that the cursor must track real input — a cursor that floats by itself looks more uncanny than no cursor at all.

## What it is

`packages/app/e2e/helpers/cursor-overlay.ts` exports four functions:

```ts
import {
  installCursorOverlay, // call once after the page is ready
  cursorClick,          // move + pause + click + pulse ring
  cursorTo,             // move only (no click)
  cursorPark,           // move to absolute (x, y) coords — for idle parking
} from './helpers/cursor-overlay'
```

`installCursorOverlay(page)` injects a fixed-position DOM element with:

- An SVG arrow (Apple-style filled white with 1.2px dark stroke)
- A `mousemove` listener (capture phase, passive) that repositions the arrow
- A `mousedown` listener that briefly adds `.pulse` to a sibling ring `<span>` for a 420ms expanding click animation

It registers via `page.addInitScript()` so it survives any unexpected page navigations, and is also injected immediately into the current page so it shows up before the first clip records.

## How to use it

In the per-release capture spec, after `launchDemoApp(seed)` and `setDemoWindowBounds(ctx, 1080, 740)`:

```ts
import { installCursorOverlay, cursorClick, cursorTo, cursorPark } from './helpers/cursor-overlay'

await waitForDemoSync(ctx.window)
await installCursorOverlay(ctx.window)
await cursorPark(ctx.window, 120, 360) // off to the side before clip 1 starts recording

await recordNativeWindow(ctx.app, OUT_DIR + '/01-foo.mov', 5.2, async () => {
  await ctx.window.waitForTimeout(550)
  await cursorClick(ctx.window, '[data-testid="<your-target>"]', {
    preClickPause: 260,
    postClickPause: 280,
  })
  await cursorPark(ctx.window, 700, 480, 22) // park on real content, NOT on next clip's target
  await ctx.window.waitForTimeout(2600)
})
```

### `cursorTo(window, selector, opts)`

Moves the synthetic cursor to the centre of the selector. Options:

- `steps` (default 16) — number of intermediate `mousemove` events Playwright dispatches. The DOM listener treats each as a frame; higher steps = smoother motion. 16–22 is the sweet spot. Above 30 the cursor feels syrupy.
- `settle` (default 0) — `waitForTimeout` after the move completes. Use a small value (200–250ms) when you want a beat between "cursor arrives" and "cursor clicks".

### `cursorClick(window, selector, opts)`

`cursorTo()` + `.click()` + optional post-click pause. Options:

- `steps` (default 16) — same as `cursorTo`
- `preClickPause` (default 220) — pause between arriving on target and firing the click. **This is the single biggest knob for natural-feel.** 220–280ms reads as "the user looked, then clicked". Below 150 feels robotic. Above 350 starts to feel hesitant.
- `postClickPause` (default 0) — pause after the click before returning. Use this when you want the result of the click to settle on screen before the next action.

### `cursorPark(window, x, y, steps = 14)`

Moves to absolute viewport coordinates (CSS pixels). Use to:

- Place the cursor in a "neutral" spot before the first recording so it's visible in frame 0
- Move it off a clickable element between scenes so it doesn't read as "about to click that"

**Important parking rules:**

- Don't park on the *next* clip's click target. A cursor that sits on `+` for 2s and then "clicks" reads as a delayed action — viewers parse it as a missed click. Park elsewhere (on an interior card, in empty chrome).
- Park on real content, not gutters. If your park position lands between cards or in empty grey space, the cursor looks abandoned. Aim for the centre of a visible element.

## Timing rules of thumb

Synthetic cursor moves are essentially **instant** from a wall-clock perspective — Playwright dispatches `mousemove` events without delay between them. The motion the viewer sees is the DOM listener catching all those events and repositioning the arrow over a single browser paint frame. So:

- `steps` controls path smoothness, not duration
- `preClickPause` is the only thing that controls "how long the cursor sits before clicking"
- A natural-feel beat is roughly:
  - 200–500ms idle / settle
  - 16–22 `steps` move (~one paint frame, but smoothed)
  - 220–280ms `preClickPause`
  - click (instant)
  - 1000–1500ms `postClickPause` to let the result settle

## Hard rules

- **One cursor only.** Don't draw your own additional cursor on top of the overlay. The cursor in the captured `.mov` should be the synthetic one and nothing else (no `screencapture -C`).
- **Install once, before any recording.** If you install it mid-spec, the first clip's first frame might be cursor-less.
- **Click pulse must come from a real `mousedown`.** Don't fire fake click animations — the pulse must trace a real input event, otherwise it'll drift out of sync with what the UI actually does.
- **Don't draw the cursor in scenes where nothing's clicked.** If a scene is just "look at this grid", park the cursor on a card and let it sit. Don't make it move for the sake of moving.

## What the overlay looks like

The arrow is a 22×22 white SVG path with a dark 1.2px stroke — visually close enough to the macOS cursor that viewers don't notice it's synthetic. The click ring is a 42×42 circle with a 2px white border that scales from 0.35 to 1.55 over 420ms with opacity fading 0.95 → 0.

Both have a subtle drop-shadow so they read against light and dark UI surfaces.

The DOM structure is `#spool-demo-cursor` with one child `<svg>` (arrow) and one `<span class="ring">` (pulse). z-index is `2147483647` so nothing in the renderer can occlude it. `pointer-events: none` so it never blocks a real click target.
