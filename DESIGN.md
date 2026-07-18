# Design System — Spool

## Product Context

- **What this is:** The publishing platform for agent sessions, starting with coding agents. Spool turns agent work into readable, discoverable, and resumable artifacts.
- **Who it is for:** Authors who want to show how they work with agents; readers looking for real workflows and reasoning; and people who want to continue useful work in their own agent.
- **Space/industry:** Developer knowledge sharing / agent-native publishing. Peers provide pieces of the experience—GitHub for code, YouTube for learning, Gists for sharing—but none treat an agent Session as a first-class public artifact that can be resumed.
- **Product surfaces:** The public web is the publishing, Profile, Discovery, and reading surface. The desktop app is the local preparation and management surface. The CLI is the agent- and automation-friendly interface.
- **Core positioning:** "See how people actually work with agents." Public Sessions and their authors are the center of the web experience; local organization and search support the act of publishing.
- **Publishing boundary:** New shares are Link-only. A separate, explicit Publish action makes a Shared Session Public and eligible for Profile and Discovery surfaces.

## Aesthetic Direction

- **Direction:** Warm Index — editorial-warm, not terminal-cold. Function-first but with personality.
- **Decoration level:** Minimal. Typography, authentic Session content, and color warmth carry the page. No gradients or decorative blobs.
- **Mood:** The feeling of finding a thoughtful piece of work in a well-kept public index. Intimate, focused, and trustworthy; never corporate or clinical.
- **Differentiation:** Developer platforms default to cold grays, dense dashboards, or social-feed gloss. Spool's warm near-blacks and amber accent frame technical work as something worth reading without disguising its provenance.

## Layout Philosophy

### Surface hierarchy

1. **Discovery** helps a visitor find a Session worth opening.
2. **Session pages** help a reader understand and continue the work.
3. **Profiles** establish authorship and collect a person’s Public Sessions.
4. **Desktop and CLI** help an author prepare, share, publish, and manage Sessions.

The public web must show the artifact before explaining the product. Real Sessions, authors, topics, and evidence carry more weight than feature illustrations.

### Public web

- **Header:** Compact and persistent. Wordmark on the left; `Explore`, `Docs`, and search in the primary navigation; `Publish` and account state on the right. `Publish` uses the amber accent.
- **Homepage:** Featured-first editorial layout. The hero pairs a concise promise with one real featured Session—never a screenshot of the desktop app. Primary CTA is `Explore sessions`; secondary CTA is `Publish yours`. Search stays compact until the public corpus is large enough to make search-first discovery useful.
- **Homepage feed:** Public Sessions appear immediately after the hero. Use information-rich rows or cards with author, agent, topic/project, Summary excerpt, evidence, and continuation state. Avoid equal-weight feature tiles.
- **Discovery:** Search is prominent at the top, followed by clear filters for topic, agent, author, and recency. Results remain readable without opening each Session.
- **Profile:** Author identity and recurring topics come first, followed by Public Sessions. Counts support the content; they are not the hero.
- **Session page:** Summary establishes intent and outcome; conversation/tool activity shows process; files and diff show evidence; Resume/Fork is the primary action after reading. Source and continuation lineage remain visible.
- **Visibility:** `Link-only`, `Public`, and `Withdrawn` are explicit text labels with icons. Never communicate visibility by icon alone at the publishing boundary.
- **Alignment:** Editorial surfaces are predominantly left-aligned. A centered treatment is acceptable only for a short empty state or a focused search affordance—not as a substitute for public content.
- **Width:** Marketing and Discovery shells use a ~1120px max width. Reading columns stay near 720px; timeline/diff workbenches may expand to the full shell.

### Desktop app

- **Core principle:** The desktop app is the author’s private preparation surface. Projects and Sessions are the home; search and publishing are actions within that context.
- **Shell:** Persistent left sidebar (240px) + main pane. Sidebar lists projects derived from `project_groups_v` and remains visible across every main-pane state.
- **Sidebar:** Warm surface background, soft right border. Top-left wordmark `Spool.`, then a `PROJECTS` section label with a sort menu, then project rows. A divider separates derived projects from the always-last `Loose` entry.
- **Project row:** Display name on the left, faint source-color dots in the middle, monospace count on the right. Active and hover states use `surface2`.
- **Home:** Pinned Sessions above a recent feed bucketed by date. Entry to search is ⌘K or the top-right trigger.
- **Project view:** Recent feed of one project with sort and source filters. A `PINNED` segment surfaces project-pinned Sessions on top.
- **Session detail:** Opens as a main-pane state, not a modal. Share and Publish actions belong in the detail header.
- **Search overlay (⌘K):** Floats above the current main pane on a dimmed backdrop, scoped to `All` or the current project. Fast and AI modes share the same surface.
- **Width:** Window width ~960px; main-pane content stays near 720px; sidebar stays fixed at 240px.

### Shape

Border radius remains restrained: 10px for cards, 8px for inputs, 6px for rows and buttons, and 4px for badges. Pill radius is reserved for focused search inputs and compact toggles.

## Typography

- **Logo/Display:** Geist Sans 700 — large, tight letter-spacing (−0.04em), the period after "Spool" in accent color.
- **UI / Body:** Geist Sans 400/500/600 — readable at 11–15px, developer-native, not overused. Do NOT use Inter, Roboto, or system-ui as primary.
- **Fragment content:** Geist Mono 400/500 — all indexed content (conversation fragments, URLs, code) rendered in monospace. This visually separates "Spool UI" from "your content."
- **Counts / paths:** Geist Mono with `font-variant-numeric: tabular-nums`.
- **Loading:** Google Fonts CDN: `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap`

### Type Scale

| Role                                  | Size    | Weight  | Font                               |
| ------------------------------------- | ------- | ------- | ---------------------------------- |
| Marketing hero                        | 48–72px | 600     | Geist Sans, letter-spacing −0.04em |
| Public page title / Profile name      | 28–36px | 600     | Geist Sans, letter-spacing −0.02em |
| Session page title                    | 24–32px | 600     | Geist Sans, letter-spacing −0.02em |
| Desktop page title                    | 20px    | 600     | Geist Sans, letter-spacing −0.01em |
| Sidebar wordmark                      | 18px    | 700     | Geist Sans, letter-spacing −0.04em |
| Search input (⌘K overlay)             | 15px    | 400     | Geist Sans                         |
| Public Summary / marketing body       | 15–17px | 400     | Geist Sans                         |
| Search input (results page)           | 13px    | 400     | Geist Sans                         |
| Body / result actions                 | 13px    | 400/500 | Geist Sans                         |
| Session content / fragments / command | 12px    | 400     | Geist Mono                         |
| Secondary / meta                      | 11px    | 400/500 | Geist Sans                         |
| Labels / caps                         | 10px    | 600     | Geist Sans, letter-spacing 0.08em  |
| Badges / paths                        | 11px    | 500/600 | Geist Mono                         |

**Floor:** 11px for body / UI / meta text. Labels-and-caps may use 10px (small uppercase reads cleanly even below the body floor). No half-pixel sizes (12.5, 13.5) — they fight sub-pixel rendering.

## Color

- **Approach:** Restrained — one amber accent, warm neutrals, color is rare and meaningful.

### Light Mode

| Token         | Hex       | Usage                                                 |
| ------------- | --------- | ----------------------------------------------------- |
| `--bg`        | `#FAFAF8` | App background — warm off-white, never pure white     |
| `--surface`   | `#F4F4F0` | Cards, titlebar, status bar                           |
| `--surface2`  | `#EEEEE9` | Hovered surfaces, mode pill background                |
| `--border`    | `#E8E8E2` | Dividers, card borders                                |
| `--border2`   | `#D8D8D0` | Input borders, focused-adjacent                       |
| `--text`      | `#1C1C18` | Primary text                                          |
| `--muted`     | `#6B6B60` | Secondary text, labels                                |
| `--faint`     | `#ADADAA` | Placeholder text, disabled state                      |
| `--accent`    | `#C85A00` | Primary accent — amber/orange                         |
| `--accent-bg` | `#FFF3E8` | Accent-tinted backgrounds (selected state, AI answer) |

### Dark Mode

| Token         | Hex       | Usage                                                |
| ------------- | --------- | ---------------------------------------------------- |
| `--bg`        | `#141410` | Warm near-black, never pure `#000`                   |
| `--surface`   | `#1C1C18` | Cards, titlebar, status bar                          |
| `--surface2`  | `#242420` | Hovered surfaces                                     |
| `--border`    | `#2E2E28` | Dividers                                             |
| `--border2`   | `#3A3A34` | Input borders                                        |
| `--text`      | `#F2F2EC` | Primary text — warm near-white                       |
| `--muted`     | `#8A8A80` | Secondary text                                       |
| `--faint`     | `#505048` | Placeholder, disabled                                |
| `--accent`    | `#F07020` | Accent brightened for dark — still amber, never blue |
| `--accent-bg` | `#2A1800` | Accent backgrounds on dark                           |

### Source Badge Colors

Each agent source has a fixed color used consistently across badges, chips, and dots.
Only currently-supported agent sources are listed. Add a row when a new source ships; never add aspirational badges preemptively.

| Source      | Light     | Dark      |
| ----------- | --------- | --------- |
| Claude Code | `#C26A4E` | `#E89A7C` |
| Codex CLI   | `#4A9670` | `#7CC9A2` |
| Gemini      | `#5887D0` | `#8AB0E5` |
| OpenCode    | `#8A6F3D` | `#C9A761` |

### Semantic States

Status colors are warm-tuned to match the rest of the palette — never use Tailwind defaults (`green-500`, `red-500`).

| State                | Light                  | Dark      |
| -------------------- | ---------------------- | --------- |
| Success / synced     | `#6BAF6B` (warm green) | `#7DC07D` |
| Warning / stale      | `#E4A640` (warm amber) | `#F0B854` |
| Error / disconnected | `#C95A4F` (terracotta) | `#D67259` |

## Spacing

### Base

- **Unit:** 4px
- **Density:** Compact in desktop lists and metadata; editorial on public pages. Session content gets enough breathing room to read for several minutes.
- **Scale:** `2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64 · 96`. 6 is allowed only for icon dots and tight inline gaps. **Off-scale is a bug** — never use 10, 14, 18, 28, 36, 40, or any half-pixel (`py-0.5`, `py-2.5`, `px-3.5`).
- **Public sections:** Use 64px vertical padding on compact sections and 96px on primary homepage sections. Mobile collapses both to 48px.

### Desktop component padding (canonical)

| Component                                | Padding                                                                                                                                                                                                        | Inner gap   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Sidebar column                           | `px-3 py-3` (12 / 12)                                                                                                                                                                                          | —           |
| Sidebar wordmark block                   | `px-4 pt-3 pb-3` (16 / 12)                                                                                                                                                                                     | —           |
| Sidebar section label (PROJECTS)         | `px-2 py-1` (8 / 4)                                                                                                                                                                                            | gap-1.5 (6) |
| Sidebar project row                      | `px-2 py-1` (8 / 4)                                                                                                                                                                                            | gap-2 (8)   |
| Sidebar status bar                       | `h-[30px] pl-4 pr-2` (16 left so the status dot lines up with the project-row folder icon column; 8 right so the 24×24 settings button sits visually centered in the count column above)                       | gap-2 (8)   |
| Search trigger (sidebar / top-right)     | `h-8 px-2` (32 / 8)                                                                                                                                                                                            | gap-2 (8)   |
| Library Home header (h1 + subtitle)      | `px-6 pt-3 pb-3` (24 / 12) — top padding matches sidebar wordmark block so titles align                                                                                                                        | —           |
| Library section label (PINNED / TODAY …) | `px-6 pt-3 pb-1` (24 horizontal; 12 above for clear section break, 4 below so the label hugs its rows — combined with row's own `py-3`, label-text-to-row-content is 16px and prior-row-to-label-text is 24px) | gap-1.5 (6) |
| Session row                              | `px-5 py-3` (20 / 12)                                                                                                                                                                                          | gap-3 (12)  |
| Icon button (kebab, pin, gear, sort)     | `w-6 h-6` hit-area, inner icon centered                                                                                                                                                                        | —           |
| Search input (⌘K overlay)                | `h-12 px-4` (48 / 16)                                                                                                                                                                                          | gap-3 (12)  |
| Search input (results page top-right)    | `h-9 px-3` (36 / 12)                                                                                                                                                                                           | gap-2 (8)   |
| AI answer card                           | `p-4` (16)                                                                                                                                                                                                     | gap-3 (12)  |

### Vertical rhythm

- Section label and its rows: zero margin between — the label's own `py-2` is the buffer
- Consecutive sections (PINNED → TODAY → YESTERDAY): zero margin between — each section's header padding provides the separation
- Sidebar groups (projects vs. Loose): single 1px divider with `my-2 mx-2` margins
- Bucket labels: non-sticky on scroll; content moves as one

### Border radius

10 cards / 8 inputs / 6 sidebar rows + buttons / 4 badges. Pill (9999) reserved for ⌘K input + mode toggle. **No 12, no 14.**

## Motion

- **Approach:** Minimal-functional — only transitions that aid comprehension.
- **⌘K overlay open/close:** Backdrop fades in (120ms), overlay card scales from 0.98 → 1 + fades in (140ms ease-out). Reverse on close.
- **Main-pane state changes (Library Home ↔ Project View ↔ Session Detail):** Instant. No slide or crossfade — sidebar context already tells the user where they are.
- **Results appear:** Fade + translate-y(4px) → 0. Duration 150ms, ease-out, staggered 20ms per item.
- **Mode switch (Fast ↔ AI):** Overlay content area crossfade 200ms.
- **Hover states:** Background 80ms, border-color 80ms — fast enough to feel instant.
- **Nothing else moves.** No scroll-driven animations, no decorative motion.

## UI States

### Discovery

- **Default:** A compact search field, topic/agent filters, and a feed of Public Sessions. Featured items may be editorially larger, but the rest of the feed uses one consistent information hierarchy.
- **Session result:** Author avatar + handle, title or first-prompt-derived label, Summary excerpt, agent/source badge, publication time, touched-file or diff evidence, and fork/resume state.
- **Empty query:** Show recent and featured Sessions, not an empty search page.
- **Empty filter:** Explain which filters produced no results and offer one-click clearing.
- **Loading:** Preserve card/row geometry with warm-neutral skeletons; do not replace the entire feed with a centered spinner.

### Profile

- **Header:** Avatar, display name, `@handle`, short bio, recurring topics/agents, and a restrained Session count.
- **Body:** Public Sessions only. Link-only Sessions never affect visible counts or empty-state wording.
- **Empty state:** “No public sessions yet.” Do not imply that the author has no local or Link-only work.

### Public Session

- **Header:** Author attribution, agent/source, `Public` label, publication time, and lineage when present.
- **First screen:** Summary and machine-derived evidence are visually separated. Summary is interpretive; files, diffstat, and tool activity are evidence.
- **Reading depth:** Summary → conversation/tool timeline → files/diff → record deep link.
- **Primary continuation action:** `Resume session` or `Fork with [agent]`. Explain that this creates new work and leaves the source unchanged.
- **Link-only Session:** Same reader, but label it `Link-only` and exclude discovery navigation that implies public listing.
- **Withdrawn:** Keep a stable unavailable page with no leaked title, Summary, author, or content.

### Publishing

- **Prepare:** Show exactly which Session and record range will be shared, secret findings, and optional Summary before network transfer.
- **Share complete:** Return the Link-only URL first. The next decision is explicit: keep Link-only or Publish publicly.
- **Publish confirmation:** Explain that the Session will appear on the author’s Profile and in Discovery. Visibility is text + icon, never a globe icon by itself.
- **After publish:** Show `Public`, copy-link, view-profile, and withdraw actions. Never collapse Share and Publish into one ambiguous toggle.

### Desktop Search (⌘K overlay)

- **Trigger:** Global ⌘K from any main-pane state. The top-right `Search…` button is the visual hint when a pointer user hasn't discovered the keystroke.
- **Overlay:** Centered card on dimmed backdrop, ~640px wide. Pill input at top, scope toggle (`All` / `[Project name]`) on the left, mode toggle on the right.
- **Mode toggle:** Pill-within-pill. Active mode gets `surface` bg + shadow. `⚡ Fast` | `🤖 AI` — replace emoji with vector icons in implementation.
- **Inline preview:** Top results render inside the overlay; pressing Enter commits to the full results page.
- **Results page (after commit):** Top-right input persists with the current query; results fill the main pane below. Sidebar remains visible.

### Result Items

- **Default:** No background, left-padded 20px.
- **Hovered:** `--surface` background.
- **Selected (keyboard):** `--accent-bg` background.
- **Action buttons:** Appear on hover/selection only (opacity 0 → 1). Primary action (Resume/Continue) uses accent border + color.

### Library Home (main pane default)

- Two stacked sections: `PINNED` (collapsible, only when non-empty) and `RECENT`, date-bucketed into:
  - `TODAY`
  - `YESTERDAY`
  - `EARLIER THIS WEEK` (last 7 days, excluding today/yesterday)
  - `EARLIER THIS MONTH` (last ~30 days, excluding the above)
  - `OLDER`
- Bucket labels render in the Labels / caps style (11px, 0.06em tracking, weight 500). Empty buckets are hidden.
- Each row uses the same `SessionRow` component as Project View, so visual rhythm is consistent across surfaces.

### Project View

- Header: project display name + session count + sort menu + source filter chips.
- Body: optional `PINNED` segment, then sessions list under the active sort.
- Empty filter state: friendly message, not a 404.

### Pin Button

- Icon-only toggle on desktop Session rows and the detail header. Filled state uses `--accent`.
- A pinned Session appears in its owning project's `PINNED` segment **and** in the global desktop Home `PINNED` section.
- Pin is a private organization action. It does not affect public ranking, Profile order, or Discovery.

### Sources Panel (Settings tab)

- Lists the built-in agent sources with their session counts.
- Status: `auto` label + green dot when watcher is healthy.

### AI Answer Card

- Left border: 3px solid `--accent`. Background: `--accent-bg`.
- Header: `🤖 Claude says` label in accent + `via ACP · local · [agent-name]` chip on the right (always show "local" — this is a trust signal).
- CTA button: outline style with accent color, not filled — keeps hierarchy below the answer.
- Replace `🤖` emoji with vector icon in implementation.

### Status Bar

- Always visible, 30px height, `--surface` background.
- Left: colored dot (green/yellow/red) + synced item count + last sync time.
- Right: `Sources ⊕` button (replace `⊕` with vector icon).
- Dot is green when sync is healthy; yellow during active sync; red only on filesystem watcher errors.

## Icons

### Library

Lucide React (`lucide-react`) — consistent stroke weight, MIT licensed. Custom SVGs only when Lucide doesn't fit (mode toggle marks, source-specific glyphs).

### Size scale (by role)

These are the sizes actually in use, verified against the renderer. Treat them as a working set chosen by role — NOT a hard whitelist. The earlier "only 12/14/16/20, stroke 1.5" rule never held in practice and is retired (see Decisions log 2026-05-26).

| Size    | Role                               | Examples                                                                         |
| ------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| 11px    | Dense leading badges in tight rows | finding severity AlertTriangle/Info, inline meta accessories                     |
| 12–13px | Row & toolbar controls             | section chevrons (12), per-row reveal eye · rescan · page meta-row controls (13) |
| 14px    | Default UI                         | sidebar folder, search trigger, kebab, menu-item icons, source badges            |
| 16px    | Page-level                         | ⌘K overlay icon, settings tab icons, mode toggle marks                           |
| 20–22px | Hero / empty-state                 | illustration-tier accents only — rare                                            |

**Rule of thumb: match the icons already adjacent to yours.** A control sitting next to a 13px icon should be 13px, not 14px "because a table said so" — consistency within a row beats global uniformity.

### Stroke

- **1.6–1.8 is the working range** (1.6 most common; 1.7/1.75 for toolbar / row controls). 1.5 is fine for larger page-level icons. Match adjacent icons.
- Filled state allowed only for active toggles (Pin filled = accent).
- Avoid ≥2px except tiny check / close glyphs that need the weight.

### Icon-text gap

- `gap-2` (8px) — default for icon + label pairs (sidebar row, button with icon, AI answer header)
- `gap-1.5` (6px) — tight inline groups (section label + chevron, source dots cluster)

### Status dot

6px circle (`w-1.5 h-1.5`). Never resize; no other circle reuses this size.

### Hit target

Icon-only buttons (kebab, pin, settings gear, sort menu): minimum **24×24px** (`w-6 h-6`) tap area, regardless of inner icon size — pad with transparent space if needed.

### Specific assignments

- **Search (sidebar trigger):** `Search` (Lucide), 14px
- **Settings (sidebar status bar):** `Settings2` (Lucide), 12px
- **Folder (project row):** custom SVG, 14px
- **Kebab (session row "more"):** custom three-dot SVG, 14px viewBox 14×14
- **Resume (session row primary action):** `SquareTerminal` (Lucide), 14px
- **Pin:** custom SVG, 14px (filled in active state)
- **Source indicators:** purpose-drawn SVGs or Lucide equivalents — emoji are placeholders only

## AI Search (ACP Integration)

- Mode is toggled inside the ⌘K overlay — same input, different backend.
- Agent selector lives in the overlay (right of the mode toggle): `Claude Code ▾` — dropdown lists all ACP-connected agents.
- Status bar shows `🤖 ACP · [agent-name] · local` when AI mode is active. The word "local" is always present — it reinforces the trust proposition.
- AI answer renders above source fragments on the results page. Sources are always shown — the AI answer without evidence would undermine trust.
- "Continue in Claude Code →" CTA uses outline button style, opens a new Claude Code session with the synthesized answer + fragments as context.

## Ownership and Attribution Language

Language follows the viewer’s relationship to the Session.

### Public web

Public Sessions belong to an author, so use author attribution rather than first person:

- `@handle · published 2h ago · Claude Code`
- `Continued from @handle/session-name`
- `12 people resumed this session`

Do not write “You discussed this” to a reader who did not author the Session. Do not imply endorsement by an agent vendor.

### Author surfaces

Desktop, account, and publishing flows may address the signed-in author directly where it adds signal:

- “Your share is Link-only.”
- “Publish this Session to your Profile?”
- “Nothing is public until you publish it.”
- “Withdrawn by you.”

In dense lists, prefer compact facts over repeated pronouns:

- ✅ `spool · today · 12 messages · sonnet-4`
- ❌ `You discussed this in spool · today · 12 messages · sonnet-4`

### Visibility copy

- `Link-only` means anyone with the URL can read it.
- `Public` means it may appear on the author’s Profile and in Discovery.
- Never call a Link-only URL `private` or `secret`.

## Anti-patterns — Never Do

- Purple/violet gradients as accent
- Generic 3-column feature grids with icons in colored circles
- A desktop screenshot as the public homepage hero—the web product is its Public Sessions and authors
- Hiding real Sessions below several screens of marketing claims
- Social vanity metrics without useful reading or continuation context
- Ambiguous visibility controls, icon-only publish actions, or language that calls a Link-only URL private
- Uniform bubbly border-radius on all elements
- Gradient buttons
- Cold grays (`#0A0A0A`, `#111111`)—always use warm near-blacks
- Inter, Roboto, or system fonts as primary UI typeface
- Emoji in production UI—replace all with vector icons

## Decisions Log

| Date       | Decision                                      | Rationale                                                                                                                    |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | Homepage is Featured-first                    | A real curated Session explains the product during community cold start; search gains prominence as the public corpus grows. |
| 2026-07-18 | Share and Publish are separate actions        | A durable URL and public discoverability carry different privacy expectations. Public visibility must always be explicit.    |
| 2026-07-18 | New shares are Link-only                      | The safest useful default is a shareable URL that does not appear on a Profile or in Discovery.                              |
| 2026-07-18 | Public metadata is author-attributed          | Readers need to know whose work they are viewing; first-person language is reserved for the author’s own surfaces.           |
| 2026-07-18 | Session pages show interpretation + evidence  | Summary helps orientation, while conversation, tools, files, and diff preserve trust and depth.                              |
| 2026-07-18 | Resume creates lineage, never mutation        | Continuation should be visible without changing the source Session.                                                          |
| 2026-07-18 | Warm amber remains the sole product accent    | Amber distinguishes Spool from cold developer tooling and supports the Warm Index direction.                                 |
| 2026-07-18 | Geist Sans for chrome; Geist Mono for records | The font split distinguishes product interface from authentic Session content, commands, paths, and URLs.                    |
| 2026-07-18 | Icons follow adjacent-role sizing             | Local consistency within a row or toolbar matters more than a rigid global icon whitelist.                                   |
