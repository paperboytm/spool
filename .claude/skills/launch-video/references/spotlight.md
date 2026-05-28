# Spotlight focus

An SVG-mask overlay that dims everything outside 1–2 transparent "holes". An alternative to amber annotation rectangles for directing the eye.

## When to use spotlight vs amber rectangle

Both techniques live inside `.window` so the camera transform applies to them. Pick based on what you want the viewer to do:

| Goal | Use |
|---|---|
| "Look at this strip" (specific feature region, no ambiguity) | Amber rectangle (precise, geometric) |
| "Read this preview while also watching this control" | Dual spotlight (preview hole always bright, control hole retargets) |
| "Focus tightens as the click happens" | Spotlight retarget (single hole moves) |
| The amber outline keeps reading as "misaligned" no matter how you measure | Spotlight (soft falloff hides drift) |

Amber rectangles are unforgiving about pixel alignment — if your measured coords are 4px off, the outline reads as "wrong". Spotlight holes have a dim falloff around their edge that absorbs small drift; you can be ±10px and the eye still lands where you want it.

## The mask structure

A single SVG covers the window. Inside is a `<mask>` with a white "shows everything" rect and 1–2 black "punches a hole" rects. The output rectangle is filled with the dim colour and references the mask, so wherever the mask is black, the dim is *not* applied (those holes show the video underneath at full brightness).

```html
<svg id="spotlight" viewBox="0 0 100 100" preserveAspectRatio="none"
     style="position:absolute; inset:0; z-index:18; pointer-events:none; opacity:0">
  <defs>
    <mask id="spotlight-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect width="100" height="100" fill="white"/>
      <rect id="hole-primary"   x="50" y="50" width="0" height="0" rx="0.8" ry="0.8" fill="black"/>
      <rect id="hole-secondary" x="50" y="50" width="0" height="0" rx="0.8" ry="0.8" fill="black"/>
    </mask>
  </defs>
  <rect width="100" height="100" fill="#121210" fill-opacity="0.70" mask="url(#spotlight-holes)"/>
</svg>
```

Coordinates are in viewBox units 0–100 (percentages of the `.window`'s logical 1000×685 box). `preserveAspectRatio="none"` lets the percentages map directly to width/height without aspect-ratio distortion. `maskUnits="userSpaceOnUse"` is required — without it the mask uses object bounding box and you'll spend an afternoon wondering why your rects render at the wrong scale.

Each hole's default size is 0×0 (invisible). GSAP retargets them via `attr` tweens.

## GSAP helpers

These belong in the composition script next to `panelIn` / `clipCut`:

```js
const NULL_HOLE = { x: 50, y: 50, w: 0, h: 0 };

function setHole(sel, rect, at) {
  const r = rect || NULL_HOLE;
  tl.set(sel, { attr: { x: r.x, y: r.y, width: r.w, height: r.h } }, at);
}
function spotlightOn(primary, at, secondary) {
  setHole("#hole-primary",   primary,   at);
  setHole("#hole-secondary", secondary, at);
  tl.set("#spotlight", { opacity: 1 }, at);
}
function spotlightOff(at) {
  tl.set("#spotlight", { opacity: 0 }, at);
}
function spotlightSnap(primary, at, secondary) {
  // Retarget without changing the overall on/off state.
  setHole("#hole-primary",   primary,   at);
  setHole("#hole-secondary", secondary, at);
}
```

Define your focus rectangles once near the top of the script, in `% of .window`. Name them after what they frame in the captured UI (a sidebar row, a card, a control), measured per release:

```js
const F = {
  sidebarTarget:  { x: 0.6,  y: 10.0, w: 20,   h: 3.4 },
  primaryRegion:  { x: 1,    y: 1,    w: 68,   h: 98 },
  controlPanel:   { x: 71.5, y: 11,   w: 26.5, h: 41 },
  // ...
};
```

Then in scene code:

```js
spotlightOn(F.sidebarTarget, 0.45);                       // single, dim everything else
spotlightSnap(F.primaryRegion, 1.55);                     // retarget, still on
spotlightSnap(F.primaryRegion, 10.15, F.controlPanel);    // dual: preview + control
spotlightSnap(F.primaryRegion, 30.15);                    // collapse secondary, single again
spotlightOff(34.50);
```

## Hard snaps only — no morph

Spotlight retargets are `tl.set()`, never `tl.to()`. A morphing spotlight (interpolating x/y/w/h between rects over 200ms) reads as a "moving frame" — the eye tracks the motion and gets distracted from the underlying content change.

A snap, paired with a click happening 100–200ms later, reads as "the eye is already there waiting" — which is the whole point.

## Single vs dual hole

**Single** — for scenes where one region matters at a time:

- Sidebar click target
- A list or grid of items
- A dropdown opening

**Dual** — for cause-and-effect scenes where two regions need to be readable at the same time:

- User clicks a control on the right; a preview on the left reflows → primary = preview, secondary = control
- User toggles a setting; an indicator updates → primary = indicator, secondary = setting
- User picks an option from a list; the staged document restyles → primary = document, secondary = option list

The convention: **primary = result / outcome**, **secondary = control / cause**. The secondary retargets per click; the primary stays fixed on the outcome throughout the scene.

## The payoff pattern

When the cause-and-effect has played its loop, collapse the secondary to `NULL_HOLE`. With one side suddenly dim, the viewer's eye has only the outcome to look at — and that's exactly when the outcome's change is the payoff.

```js
// Dual: outcome + control both bright while the user toggles.
spotlightSnap(F.primaryRegion, 25.65, F.controlPanel);
// After the final click, kill the secondary.
// Only the outcome stays lit — its state change reads as the answer.
spotlightSnap(F.primaryRegion, 29.65);
```

This is a deliberate 0.5–1.0s moment of "look here, this is the answer." Particularly useful for features whose payoff is subtle (a count collapsing, a state flip, a value vanishing) and would get lost in a busy dual-spotlight frame.

## Measuring hole coordinates

Same workflow as amber rectangles, but with one advantage: spotlight is forgiving. If you measure roughly and the rect is 5–10px off, the dim falloff absorbs it. Don't sweat sub-pixel measurement — measure once to within ~1% and move on.

1. Extract a raw `.mov` frame where the target is fully visible.
2. Crop to the target region with `ffmpeg -i frame.png -vf "crop=W:H:X:Y" cropped.png`.
3. Measure the bounding box in source pixels (typically the captured `.mov` is 2160×1480 retina).
4. Convert to viewBox units: `x_vb = x_px / 21.6`, `y_vb = y_px / 14.8`, `w_vb = w_px / 21.6`, `h_vb = h_px / 14.8` (for a 1000×685 window).
5. Add 0.5–1% padding on each side so the bright zone has breathing room.

## clipCut interaction

`spotlightSnap` doesn't change which clip is visible — it just moves the holes. When a scene changes underlying clips, the spotlight coords usually don't need to change if the layout is the same (controls in the same place, outcome in the same place). Retarget only when the *active control* changes from one row/element to another.

Order of operations at scene boundaries:

```js
// Panel anchors first (0.4s lead — see composition.md on panel-leads-spotlight)
panelIn("#panelN", 14.85);
// Clip swaps next
clipCut("#clip-prev", "#clip-next", 14.65);
// Spotlight retargets last
spotlightSnap(F.primaryRegion, 15.25, F.controlPanel);
```

## Common pitfalls

- **The mask rect coords are in viewBox units, not CSS pixels.** If your hole is 220px wide on a 1000px-wide window, that's `w: 22`. Not `w: 220`.
- **`maskUnits="userSpaceOnUse"` is mandatory.** Without it the mask renders at object bounding box and you'll see no holes (or holes at 100× scale).
- **The dim fill colour and opacity together set the "how dark" feel.** `#121210` at `fill-opacity="0.70"` gives a strong dim that still lets shapes read through; `0.85` gets close to "obscured" which can feel too aggressive for steady-state scenes.
- **No border on the bright zone.** A coloured outline around the spotlight makes the holes feel like "frames" and any coordinate drift becomes glaring. The soft falloff at the alpha boundary is the whole point.
