# Pitfalls

What we tried during v0.4.11 that looked bad in motion, and what to do instead. Read this **before** improvising on the proven layout.

## 1. Cursors that don't track real input look uncanny

We built three iterations of a *standalone* GSAP cursor that flew across the screen on its own to "click" buttons. Every version felt wrong:

- Linear motion → robotic
- Bezier + overshoot → bouncy in a video-game way
- Designed amber dot with click pulse → still artificial because it wasn't synced to anything physical in the clip

**Why:** a cursor with no input event behind it is the problem. The viewer's brain reads "this isn't a real interaction" within ~100ms.

**Do instead, depending on the scene:**

- **No cursor at all** — for scenes where the change carries the story (new pinned strip appears, updater banner flips state). Use amber annotation rectangles to call out the *result*.
- **Synthetic cursor that tracks Playwright** — for scenes where the *click* is the story (clicking + opens a picker; clicking a template re-flows the preview). Inject a DOM cursor that follows real `mousemove` events and pulses on real `mousedown`. See `cursor-overlay.md`. The cursor is now driven by genuine input, so the click rhythm matches the UI's response. This was the v0.5.0 fix and it works.

The hard rule is: **a cursor in frame must trace real input.** A cursor that floats on its own is worse than no cursor at all.

## 2. Decorative chrome adds nothing

We tried, in turn: a vignette over the canvas, a top-right "callsign" (`SPOOL · v0.4.11 · LAUNCH`), a bottom 1px amber progress strip, a film grain overlay. Each one made the video feel more "designed" and *less* intentional — like a YouTuber's title sequence rather than a product announcement.

**Do instead:** trust the brand mark in the top-left and the text panel on the left to anchor the composition. The amber annotations on the demo window are the only accent layer that earns its place.

## 3. PPT-style title cards kill momentum

First attempt: each scene started with a centered title card (kicker + big headline), held for ~1s, then cut to the demo. Watching back it felt like a slide deck.

**Why:** the pause between "title" and "demo" makes the viewer's brain treat them as separate beats — interrupting the flow.

**Do instead:** text panel + demo coexist continuously. The panel contents change per scene, the demo plays in parallel. Hard-cuts between feature clips, no card pauses.

## 4. Smooth multi-second camera drifts feel like PowerPoint pans

We tried slow zooms (~3s) over a scene to "show" the feature area. Reads as a Ken Burns slideshow effect, not a trailer move.

**Do instead:** zoom into the focal region within ~0.6s (`power2.inOut`), hold there for the scene, then hard-cut to the next. Camera moves are short and motivated, not ambient.

## 5. "Pull back to neutral" before the outro feels deflating

We had the camera zoom back out to `scale: 1` before fading to the Spool lockup. It made the ending feel like the show was retreating instead of resolving.

**Do instead:** end scene 4 on its feature focus. Fade window + brand + annotation directly to the outro card from that zoomed state. The cut is sharper.

## 6. First frame must be content, not animation prelude

When window/panel/brand mark all fade in from `opacity: 0` over the first 0.5s, the encoded MP4's first frame is mostly black. Twitter auto-thumbnails grab that black frame as the preview.

**Do instead:** scene 1's elements (`#panel1`, `#window`, `#brand-mark`) must be `opacity: 1` at `t=0` in the CSS. No entrance animation for scene 1. Then `tpad clone` the first 0.5s during post-processing for extra insurance (see `poster.md`).

## 7. The annotation rectangle position is per-release

`pinned-section: top 15%, height 13%` was right for v0.4.11. For v0.5.0 the UI WILL be different — different feature regions, possibly different sidebar density, etc.

**Don't:** copy old coords forward.
**Do:** measure fresh from your captured `.mov` frames every release. The `composition.md` reference explains how.

## 8. Avoid background-bleed at window corners

`screencapture -R` records a rectangle. Outside the macOS window's rounded corners, you see the desktop background — sometimes white, sometimes light depending on the user's wallpaper.

**Solution:** the `.window` element in the composition has `border-radius: 8px; overflow: hidden`. This clips the corners to a radius close enough to macOS's native that no background pixels show.

`8px` is empirically right. Smaller → background bleeds through. Larger → app chrome (traffic lights) gets clipped.

## 9. Don't beat-lock everything

The video has ~6–8 strong beats from the BGM. Don't try to land every scene cut + annotation reveal + camera move on a beat — over-syncing reads as desperate.

**Do:** anchor the major scene transitions to phrase boundaries (every ~7s in our BGM). Let everything else float naturally.

## 10. Real screen recordings, not mock UIs

Early attempts at hand-built HTML mockups of the Spool UI inside the composition iterate for hours and still look uncanny — wrong row heights, wrong icons, wrong rhythm.

**Lesson:** always record the real Electron app. The capture pipeline exists for a reason. Don't try to recreate the UI in HTML, ever.

(Exception: a stylised post-demo capstone card — a document or artefact summary that's *explicitly not the app UI* — is fine because the viewer reads it as a separate object, not a fake UI. See `composition.md` § Optional capstone scene.)

## 11. Clip-boundary gap (the silent full-screen flash)

Two adjacent video clips, both showing visually identical UI states at the boundary, *should* swap invisibly. But on rendered output you can see a single frame of near-black at the exact cut, reading as a full-screen flash.

**Root cause:** clip A's `data-duration` ended before clip B's `data-start` began. Even by 0.13s. During that gap, neither video element was "playing" — clip A had ended (browsers show a frozen last frame, but the HyperFrames renderer may release the buffer), clip B wasn't seekable yet. The result was a frame the renderer composed against an empty video element.

**The math you have to satisfy:**

```
prev_clip.data_start + prev_clip.data_duration ≥ next_clip.data_start + 0.10
```

In English: the previous clip must still be playing when the next clip starts to take over. Aim for ≥ 0.20s overlap. Tighten the next clip's `data-start` earlier rather than extending the previous clip's `data-duration` past the end of the actual `.mov` file (a video element past its natural end may render unpredictably).

Also bring the incoming clip's opacity up 0.20s **before** the boundary (`clipCut` already does this), so the renderer has time to decode the first frame before the outgoing clip disappears.

**Bonus fix in the `clipCut` helper:** bring the incoming clip's opacity up *before* the boundary, not at it:

```js
function clipCut(outSel, inSel, at) {
  tl.set(inSel,  { opacity: 1 }, at - 0.20);  // ← lead by 0.20s
  tl.set(outSel, { opacity: 0 }, at + 0.10);  // ← outgoing lags 0.10s
}
```

This gives the renderer time to decode the incoming clip's first frame before the outgoing one disappears. The 0.30s overlap is invisible because both clips show identical editor state at the boundary anyway.

## 12. Pre-clip state resets cause a flash at the cut

If you "reset" the demo's UI state between recordings (clicking different options to clean up for the next clip's start), the composition cuts from clip N's end-state to clip N+1's start-state and the UI visibly jumps. The viewer's brain registers it as a glitch even though both states were technically valid.

**Why:** the reset clicks happened *outside* the recordings, so the viewer never saw the cause. A state change with no cause reads as a bug.

**Do instead, in order of preference:**

1. **Chain state.** Clip A ends with whatever state, clip B starts there. No reset between recordings. Design the demo flow so the natural state at each beat is what you want.
2. **Reset *inside* a recording.** If you must change state mid-demo to land a later beat on the right configuration, do it via visible cursor clicks during a recorded clip — the viewer sees the user making the choice.
3. **Never** reset between clips and hope the panel transition will mask it. It won't.

## 13. Cognitive budget per scene

A 5-second scene shows the viewer two channels in parallel: a panel headline + sub on the left, a demo action sequence on the right. You can fit either:

- **One action + a full panel read** — cursor moves, one click, result settles. Viewer reads kicker + 2-line headline + 2-line sub.
- **Up to 2 actions + a partial panel read** — cursor moves, click, settle ~1s, click again, settle. Viewer reads kicker + headline; the sub gets skimmed.

**You cannot fit 3 actions in 5s with a panel.** The viewer's eyes can't track three sequential clicks on the right while reading a paragraph on the left. The third action might as well not exist — middle-of-the-sequence clicks slip by uncounted while the eye snaps between text and UI.

**Rule:** ≤ 2 clicks per scene if the panel has a sub. If you absolutely need to demo more variations, give it its own scene with a shorter panel.

## 14. Panel must lead the spotlight by ~0.4s

Synchronising `panelIn()` and `spotlightSnap()` at the same instant means the viewer's eyes have nowhere to land first — text on the left and a region lighting up on the right both demand attention, and they end up tracking neither.

**Do:** fire `panelIn(...)` first, then `spotlightSnap(...)` 0.3–0.4s later, then the click another 0.3–0.5s after that. The viewer reads the headline → finds where to look → sees the action.

```js
panelIn("#panelN", T);                              // 0.00s: text anchors
spotlightSnap(F.primaryRegion, T + 0.40, F.controlPanel); // 0.40s: highlight arrives
// click in the captured clip lands around T + 1.30s        // ~1.30s: action lands
```

This is the single most impactful timing rule for readability. Without it the video reads as "everything happening at once and I can't follow." With it the video has a natural rhythm.

## 15. Spotlight coords must be verified on the rendered frame, not eyeballed off a grid

Measuring focus rectangles by reading gridlines on a raw `.mov` frame is unreliable: the frame's content position can differ from the composition's display state (e.g. the captured clip is in an unfiltered state while the composition plays it after a filter has been applied, shifting rows down). Eyeballed coords come out 5–15% too high or low and read as "the spotlight isn't framing anything specific."

**Do this closed loop before re-rendering:**

1. Set your `F.region` coords.
2. Compute the hole's canvas rect: `x_canvas = 700 + 10·x`, `y_canvas = 197 + 6.85·y`, `w_canvas = 10·w`, `h_canvas = 6.85·h` (window at canvas 700,197 sized 1000×685; viewBox 0–100).
3. Overlay that rect on the existing rendered frame with `ffmpeg -ss <t> -i final.mp4 -frames:v 1 -vf "drawbox=x=…:y=…:w=…:h=…:color=lime:t=3" check.png`.
4. Open `check.png`. If the bright box doesn't tightly frame its target, adjust coords and re-draw — content position is independent of the spotlight, so you don't need to re-render to iterate.
5. Re-render only after every region's box visibly frames its target.

The dim opacity also matters: against a dark UI, `fill-opacity=0.70` reads as nearly no dim, washing out the focus. `0.80` gives noticeable but not aggressive contrast.
