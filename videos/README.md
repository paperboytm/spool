# Release videos

Production pipeline for Spool's release announcement videos (Twitter / X clips).

Each release gets a directory: `videos/spool-vX.Y.Z/`. The flow is:

1. **Capture** raw `.mov` clips from a real Electron build via the e2e helpers
2. **Compose** the clips into a HyperFrames timeline based on the template
3. **Render** to MP4
4. **Post-process** the first frame so social-media auto-thumbnails grab something informative

For the underlying methodology (text-panel + window layout, annotation tracking, common pitfalls, beat sync), invoke the `launch-video` skill — it walks Claude Code through the workflow with current best practices. This README is the human-facing entry point.

## Capture (macOS only)

The helpers under `packages/app/e2e/helpers/` are the building blocks:

- `demo-fixtures.ts` — `buildDemoFixtures(tmpDir, projects)` writes Claude / Codex / Gemini fixture files for a programmatic project list. Per release, you author a fresh `ProjectSeed[]` that reflects what the demo should show.
- `demo-launch.ts` — `launchDemoApp(seed)` + `setDemoWindowBounds(ctx, w, h)` launch the Electron app pointing at those fixtures, force dark mode, and set the canonical `1080×740` window size.
- `demo-interactions.ts` — Spool-specific UI helpers: `emitUpdateStatus()` (push updater banner state via IPC without a real download), `pinFirstRowInProject()` (hover + click the pin button on the first row).
- `native-window-capture.ts` — macOS-native screen capture: `recordNativeWindow()` uses `screencapture -V -R` against the Quartz window id (resolved via a tiny Swift one-liner so we get the right window when multiple are open).

For each release you write a small ad-hoc Playwright spec that imports these helpers and choreographs the clips you want — typically one `.mov` per feature. Output goes to `videos/<release>/assets/live/`.

The spec is **per-release and not committed**. After the release ships you can delete it; the helpers stay.

## Compose

`videos/launch-template/` is the starting point — a HyperFrames composition skeleton with the proven layout (left text panel + right UI window + amber feature annotations + Spool brand mark). Copy it to `videos/spool-vX.Y.Z/`, swap in your clips, update panel copy and annotation coords per feature.

```bash
cp -r videos/launch-template videos/spool-vX.Y.Z
cd videos/spool-vX.Y.Z
# drop your .mov clips into assets/live/
# edit index.html — panel copy, scene order, annotation %s
npm run check       # lint + validate + inspect
npm run dev         # live preview
```

Coordinates for annotations (the amber outline + label that highlights a feature region) need to be measured fresh from your captured clips — the positions change every release. The skill explains how.

## Render

```bash
npm run render -- --quality standard --output renders/spool-vX.Y.Z-final.mp4
```

Then patch the first frame so social-media auto-thumbnails grab the hero state instead of the leading black frame `screencapture` sometimes emits:

```bash
ffmpeg -i renders/spool-vX.Y.Z-final.mp4 \
  -vf "tpad=start_mode=clone:start_duration=0.5" \
  -af "adelay=500|500" \
  -c:v libx264 -preset slow -crf 18 \
  -c:a aac -b:a 192k -pix_fmt yuv420p -movflags +faststart \
  renders/spool-vX.Y.Z-poster.mp4
```

## What lives where

|                                             | Where                                                      |
| ------------------------------------------- | ---------------------------------------------------------- |
| Capture primitives                          | `packages/app/e2e/helpers/` (committed)                    |
| Per-release seed + recording spec           | ad-hoc, not committed                                      |
| Composition skeleton                        | `videos/launch-template/` (committed)                      |
| Per-release composition source              | `videos/spool-vX.Y.Z/index.html` etc. (committed)          |
| Per-release `assets/` (clips, audio, logos) | gitignored — regenerated per release                       |
| Rendered `.mp4` / poster `.jpg`             | `videos/*/renders/` (gitignored — ship to social, not git) |
| Methodology + checklists                    | the `launch-video` skill                                   |

The `assets/` directory under each release is **entirely gitignored**. Raw `.mov` captures come from the e2e helpers; audio tracks are sourced per release (licensing varies); Spool brand assets (logo SVGs) should be referenced from the main repo or inlined into `index.html`, not duplicated into each video project.
