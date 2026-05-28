# Launch video template

Starting point for a Spool release video. Copy this directory to `videos/spool-vX.Y.Z/`, fill in the placeholders, render.

## Layout (do not change without reason)

- Canvas 1920×1080
- Left text panel at `x=132`, vertically centered around `y=540`
  - Persistent `Spool. vX.Y.Z · LAUNCH` brand mark in upper-left
  - Per-scene `panel-kicker` (mono) + `panel-headline` (sans, 2 lines) + `panel-sub`
- Right window at `x=700, top=197, 1000×685, border-radius: 8px`
  - Layered drop-shadow for "floating" feel
  - Per-scene clip swap via opacity (instant), camera focus via `transform-origin + scale`
- Per-feature amber annotation rectangles (inside `.window`, so they track the camera)
- Outro fades to a `Spool.` lockup + version

The proven aesthetic decisions live in the `launch-video` skill — read its `references/composition.md` and `references/pitfalls.md` before deviating.

## Per-release customisation

The whole `assets/` directory under each release is **gitignored** — drop clips, audio, and logos in there, but never commit them. They're regenerated or re-sourced per release.

1. Drop clips into `assets/live/` (one `.mov` per feature). Name them `01-<feature>.mov`, `02-<feature>.mov`, etc.
2. Update each `<video>` element in `index.html`: `id`, `src`, `data-start`, `data-duration`.
3. Update the text panels in `index.html`: kicker number + feature name, headline (2 lines), sub copy.
4. Re-measure annotation coords for each feature region. The UI changes between releases — last release's `top: 15%` will be wrong for this release. The skill's `references/composition.md` explains how to measure.
5. Pick a BGM track and drop it as `assets/bgm.mp3`. Licensing varies, source per release. Beat-sync key camera moves to the strong beats (`ffmpeg silencedetect` to find them).

## Run

```bash
npm install
npm run check       # hyperframes lint + validate + inspect
npm run dev         # preview in browser
npm run render -- --quality standard --output renders/final.mp4
```
