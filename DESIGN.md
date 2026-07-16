# Design System — Spool

## Product Context
- **What this is:** A local AI session library — an Electron macOS app that collects, organizes, and lets you revisit every Claude Code, Codex, Gemini, Antigravity, and OpenCode session you've ever had.
- **Who it's for:** Developers who think with AI daily and have accumulated hundreds of sessions across multiple tools. The persona is overwhelmed by the archive itself, not only by re-explaining context.
- **Space/industry:** Developer productivity / local-first tooling. Peers: Raycast, Spotlight, Obsidian, DevonThink — but none of them treat AI sessions as first-class library items.
- **Project type:** macOS Electron app — sidebar + main pane shell, the shape of a library client.
- **Core positioning:** "Your AI session library." The shell (sidebar of projects, main pane of sessions) is the home; ⌘K search is one of several entry points, not the front door.

## Aesthetic Direction
- **Direction:** Warm Index — library-warm, not terminal-cold. Function-first but with personality.
- **Decoration level:** Minimal. Typography and color warmth carry everything. No gradients, no decorative blobs.
- **Mood:** The feeling of finding something in a personal archive under a warm lamp. Intimate, fast, trustworthy. Not corporate, not clinical.
- **Differentiation:** Every competitor (Raycast, Alfred, DevonThink) uses cold grays or pure blacks. Spool's warm near-blacks and amber accent are a deliberate departure — the product deals with memory and personal thinking, and should feel accordingly.

## Layout Philosophy
- **Core principle:** Spool is an AI session library. The sidebar (projects) and main pane (sessions) are the home; search is one of several entry points, reachable via ⌘K.
- **Shell:** Persistent left sidebar (240px) + main pane. Sidebar lists projects derived from `project_groups_v` and is always visible across every main-pane state.
- **Sidebar:** Warm surface background, soft right border. Top-left wordmark `Spool.`, then a `PROJECTS` section label with a sort menu, then project rows. A divider separates derived projects from the always-last `Loose` entry.
- **Project row:** Display name on the left, faint source-color dots in the middle, monospace count on the right. Active row uses `surface2` background. Hover lifts to the same `surface2`.
- **Library home (default main pane):** Pinned section (collapsible, only when non-empty) above a recent-sessions feed bucketed by date. No centered hero, no global search box — entry to search is ⌘K or the top-right input on the results page.
- **Project view:** Recent feed of one project with sort menu (Recent / Oldest / Most messages / Title) and source filter chips. A `PINNED` segment surfaces project-pinned sessions on top.
- **Session detail:** Opens as a main-pane state (not a modal); sidebar stays. Action button row sits in the detail header.
- **Search overlay (⌘K):** Floats above the current main pane on a dimmed backdrop, scoped to `All` or the current project. Same overlay surface for Fast and AI modes.
- **Approach:** Library client. Window width ~960px to fit sidebar + main pane comfortably. Not a search utility, not a dashboard.
- **Alignment:** Left-aligned everywhere. No centered hero state in the shell — the centered ⌘K overlay is the only exception.
- **Max content width:** Main pane content stays at ~720px max for readability; sidebar fixed 240px.
- **Border radius:** 10px for cards / 8px for inputs / 6px for sidebar rows and buttons / 4px for badges. Pill (9999px) reserved for the ⌘K overlay search input and mode toggle.

## Typography
- **Logo/Display:** Geist Sans 700 — large, tight letter-spacing (−0.04em), the period after "Spool" in accent color.
- **UI / Body:** Geist Sans 400/500/600 — readable at 11–15px, developer-native, not overused. Do NOT use Inter, Roboto, or system-ui as primary.
- **Fragment content:** Geist Mono 400/500 — all indexed content (conversation fragments, URLs, code) rendered in monospace. This visually separates "Spool UI" from "your content."
- **Counts / paths:** Geist Mono with `font-variant-numeric: tabular-nums`.
- **Loading:** Google Fonts CDN: `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap`

### Type Scale
| Role | Size | Weight | Font |
|------|------|--------|------|
| Page title (Library Home, Settings) | 20px | 600 | Geist Sans, letter-spacing −0.01em |
| Sidebar wordmark | 18px | 700 | Geist Sans, letter-spacing −0.04em |
| Search input (⌘K overlay) | 15px | 400 | Geist Sans |
| Search input (results page) | 13px | 400 | Geist Sans |
| Body / result actions | 13px | 400/500 | Geist Sans |
| Fragment content | 12px | 400 | Geist Mono |
| Secondary / meta | 11px | 400/500 | Geist Sans |
| Labels / caps | 10px | 600 | Geist Sans, letter-spacing 0.08em |
| Badges / paths | 11px | 500/600 | Geist Mono |

**Floor:** 11px for body / UI / meta text. Labels-and-caps may use 10px (small uppercase reads cleanly even below the body floor). No half-pixel sizes (12.5, 13.5) — they fight sub-pixel rendering.

## Color
- **Approach:** Restrained — one amber accent, warm neutrals, color is rare and meaningful.

### Light Mode
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#FAFAF8` | App background — warm off-white, never pure white |
| `--surface` | `#F4F4F0` | Cards, titlebar, status bar |
| `--surface2` | `#EEEEE9` | Hovered surfaces, mode pill background |
| `--border` | `#E8E8E2` | Dividers, card borders |
| `--border2` | `#D8D8D0` | Input borders, focused-adjacent |
| `--text` | `#1C1C18` | Primary text |
| `--muted` | `#6B6B60` | Secondary text, labels |
| `--faint` | `#ADADAA` | Placeholder text, disabled state |
| `--accent` | `#C85A00` | Primary accent — amber/orange |
| `--accent-bg` | `#FFF3E8` | Accent-tinted backgrounds (selected state, AI answer) |

### Dark Mode
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#141410` | Warm near-black, never pure `#000` |
| `--surface` | `#1C1C18` | Cards, titlebar, status bar |
| `--surface2` | `#242420` | Hovered surfaces |
| `--border` | `#2E2E28` | Dividers |
| `--border2` | `#3A3A34` | Input borders |
| `--text` | `#F2F2EC` | Primary text — warm near-white |
| `--muted` | `#8A8A80` | Secondary text |
| `--faint` | `#505048` | Placeholder, disabled |
| `--accent` | `#F07020` | Accent brightened for dark — still amber, never blue |
| `--accent-bg` | `#2A1800` | Accent backgrounds on dark |

### Source Badge Colors
Each agent source has a fixed color used consistently across badges, chips, and dots.
Only currently-supported agent sources are listed. New sources arrive via the daemon — add a row when shipped, never preemptively.

| Source | Light | Dark |
|--------|-------|------|
| Claude Code | `#C26A4E` | `#E89A7C` |
| Codex CLI | `#4A9670` | `#7CC9A2` |
| Gemini | `#5887D0` | `#8AB0E5` |
| Antigravity | `#6B5CA5` | `#9B8FD0` |
| OpenCode | `#8A6F3D` | `#C9A761` |

### Semantic States
Status colors are warm-tuned to match the rest of the palette — never use Tailwind defaults (`green-500`, `red-500`).

| State | Light | Dark |
|-------|-------|------|
| Success / synced | `#6BAF6B` (warm green) | `#7DC07D` |
| Warning / stale | `#E4A640` (warm amber) | `#F0B854` |
| Error / disconnected | `#C95A4F` (terracotta) | `#D67259` |

## Spacing

### Base
- **Unit:** 4px
- **Density:** Compact. This is a library client, not a document editor — rows should fit at scale.
- **Scale:** `2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48`. 6 is allowed only for icon dots and tight inline gaps. **Off-scale is a bug** — never use 10, 14, 18, 28, 36, 40, or any half-pixel (`py-0.5`, `py-2.5`, `px-3.5`).

### Component padding (canonical)
| Component | Padding | Inner gap |
|-----------|---------|-----------|
| Sidebar column | `px-3 py-3` (12 / 12) | — |
| Sidebar wordmark block | `px-4 pt-3 pb-3` (16 / 12) | — |
| Sidebar section label (PROJECTS) | `px-2 py-1` (8 / 4) | gap-1.5 (6) |
| Sidebar project row | `px-2 py-1` (8 / 4) | gap-2 (8) |
| Sidebar status bar | `h-[30px] pl-4 pr-2` (16 left so the status dot lines up with the project-row folder icon column; 8 right so the 24×24 settings button sits visually centered in the count column above) | gap-2 (8) |
| Search trigger (sidebar / top-right) | `h-8 px-2` (32 / 8) | gap-2 (8) |
| Library Home header (h1 + subtitle) | `px-6 pt-3 pb-3` (24 / 12) — top padding matches sidebar wordmark block so titles align | — |
| Library section label (PINNED / TODAY …) | `px-6 pt-3 pb-1` (24 horizontal; 12 above for clear section break, 4 below so the label hugs its rows — combined with row's own `py-3`, label-text-to-row-content is 16px and prior-row-to-label-text is 24px) | gap-1.5 (6) |
| Session row | `px-5 py-3` (20 / 12) | gap-3 (12) |
| Icon button (kebab, pin, gear, sort) | `w-6 h-6` hit-area, inner icon centered | — |
| Search input (⌘K overlay) | `h-12 px-4` (48 / 16) | gap-3 (12) |
| Search input (results page top-right) | `h-9 px-3` (36 / 12) | gap-2 (8) |
| AI answer card | `p-4` (16) | gap-3 (12) |

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

### Search (⌘K overlay)
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
- Icon-only toggle on session rows and the detail header. Filled state uses `--accent`.
- A pinned session appears in its owning project's `PINNED` segment **and** in the global Library Home `PINNED` section.
- Replaces the older Star concept; star-prefixed code/UI was migrated wholesale.

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

| Size | Role | Examples |
|------|------|----------|
| 11px | Dense leading badges in tight rows | finding severity AlertTriangle/Info, inline meta accessories |
| 12–13px | Row & toolbar controls | section chevrons (12), per-row reveal eye · rescan · page meta-row controls (13) |
| 14px | Default UI | sidebar folder, search trigger, kebab, menu-item icons, source badges |
| 16px | Page-level | ⌘K overlay icon, settings tab icons, mode toggle marks |
| 20–22px | Hero / empty-state | illustration-tier accents only — rare |

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

## First-Person Language
The library is yours by definition — leverage that, but **don't prefix every list row** with "You discussed this". Repeating the frame on hundreds of rows clutters more than it warms.

Use first-person framing **where it adds signal**:
- Empty states ("Nothing here yet — your first session will land here.")
- Single-session detail header ("You discussed this on Mar 15 in Claude Code.")
- Action confirmations ("Pinned by you", "You saved this in October")
- Settings-level copy that addresses the user

In list contexts (Library Home, Project View, search results), trust the surrounding chrome (sidebar, project name, source badge) to convey ownership; render metadata as compact facts:
- ✅ `spool · today · 12 messages · sonnet-4`
- ❌ `You discussed this in spool · today · 12 messages · sonnet-4`

## Anti-patterns — Never Do
- Purple/violet gradients as accent
- 3-column feature grid with icons in colored circles
- Centered hero or search box anywhere in the shell — the library shell is left-aligned everywhere; the ⌘K overlay is the only centered surface
- Uniform bubbly border-radius on all elements (overlay search input is pill; buttons are 6px; badges are 4px)
- Gradient buttons
- Cold grays (`#0A0A0A`, `#111111`) — always use warm near-blacks
- Inter, Roboto, or system fonts as primary typeface
- Emoji in production UI — replace all with vector icons

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-27 | Warm amber accent `#C85A00` | Every competitor is cold gray/blue. Amber evokes memory, archive, warmth — fits "personal thinking" positioning. Unique in the category. |
| 2026-03-27 | Google-homepage idle state (centered logo + search) | The search box IS the product. Empty space creates gravity. Google proved this mental model works at scale. |
| 2026-03-27 | Geist Mono for fragment content | Visually separates "Spool UI chrome" from "your indexed content." Monospace signals: this is real data, not a label. |
| 2026-03-27 | Source chips below home search bar | Sources are first-class — not buried in settings. Chips show what's in your index at a glance and invite expansion. |
| 2026-03-27 | First-person result language ("You discussed this") | Differentiates from a generic log viewer. Makes the product feel like it knows you. |
| 2026-03-27 | "via ACP · local" label on AI answers | Trust signal — users need to see that inference is local, not routed to a cloud. Core to local-first positioning. |
| 2026-03-27 | Emoji as placeholder icons only | Emojis are fast to prototype with but inconsistent across platforms. All production icons must be vector (Lucide or custom SVG). |
| 2026-04-30 | Library-first shell replaces centered search home | Session counts grew into the hundreds across multiple agents. Users need to browse and organize, not only search. Sidebar/projects/sessions become the home; search retreats to ⌘K. Reverses the 2026-03-27 "search box is the product" decision. |
| 2026-04-30 | Pin replaces Star | Per-project pin-to-top with a global Library Home `PINNED` segment. Star UI removed wholesale; underlying data migrated. Pin reads as a library verb (where Star reads as a feed verb) and matches the new framing. |
| 2026-04-30 | ⌘K overlay for search | Overlay scopes to All or the current project and hosts both Fast and AI modes. Persistent top-right `Search…` button is the discoverability hint. |
| 2026-05-08 | Locked icon scale (12 / 14 / 16 / 20) and component padding lookup table | Audit found six icon sizes (9/11/12/13/14/16) and seven off-scale paddings in use. Without per-component spec, the system was self-inconsistent. Fixed scale + canonical padding table makes drift detectable. |
| 2026-05-08 | Warm-tuned status colors replace Tailwind defaults | `green-400 / amber-400 / red-400` were the only un-tuned colors in the system. Replaced with warm green `#6BAF6B`, warm amber `#E4A640`, terracotta `#C95A4F` so status reads as part of the same palette. |
| 2026-05-08 | Page title type added (20px) | Library Home and Settings need a real h1 — previous scale topped at sidebar wordmark 16px, leaving the home pane labelless. |
| 2026-05-08 | First-person rule softened from "all metadata" to "where it adds signal" | Literal "You discussed this · Mar 15" prefix on every row was repetitive once a user had hundreds of sessions. Library context already conveys ownership; reserve first-person for empty states, detail headers, and confirmations. |
| 2026-05-08 | Source badge list trimmed to active agents only | Twitter / GitHub / YouTube / ChatGPT were carryover from the connector era. Spool ships only Claude Code / Codex CLI / Gemini / Antigravity today; new sources arrive via the daemon and get a row when shipped, not preemptively. |
| 2026-05-26 | Retire the "icons only 12/14/16/20, stroke 1.5" rule — describe reality instead | The 2026-05-08 lock never held: the renderer actually uses 11/12/13/14 (13 & 14 dominant) at strokes 1.6–1.8 (1.6 most common, 1.5 a minority). The aspirational whitelist was actively misleading new work into picking sizes that clashed with adjacent icons. Replaced with a role-based working set + a "match adjacent icons" rule. Sizes/strokes are now chosen for local consistency, not global uniformity. |
