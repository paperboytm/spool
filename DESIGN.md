# Design System — Spool

## Product Context

- **What this is:** The publishing platform for agent sessions, starting with coding agents. Spool turns agent work into readable, discoverable, and resumable artifacts.
- **Who it is for:** Authors who want to show how they work with agents; readers looking for real workflows and reasoning; and people who want to continue useful work in their own agent.
- **Space/industry:** Developer knowledge sharing / agent-native publishing. Peers provide pieces of the experience—GitHub for code, YouTube for learning, Gists for sharing—but none treat an agent Session as a first-class public artifact that can be resumed.
- **Product surfaces:** The public web is the publishing, Profile, Discovery, and reading surface. The installed CLI is the local preparation, management, agent, and automation interface. The legacy Electron app is not distributed.
- **Core positioning:** "See how people actually work with agents." Public Sessions and their authors are the center of the web experience; local organization and search support the act of publishing.
- **Publishing boundary:** Share is the explicit disclosure action. Claude Code and Codex CLI Shares are Public and eligible for Discovery by default; providers not yet supported by Explore remain Link-only. The confirmation must state the resulting visibility before upload.
- **Workspace boundary:** A Team is an explicit tenant, backed by one WorkOS Organization and one Spool authorization projection. Team-owned Sessions survive an individual member leaving or deleting their account. Personal and Team storage, authorization, quotas, and audit records must never be inferred from navigation state alone.

## Aesthetic Direction

- **Direction:** Void Index — Framer-derived void black + electric blue over the Warm Index structure. Function-first but with personality.
- **Decoration level:** Minimal on product and reading surfaces. The marketing homepage may use one cinematic WebGL knowledge-space scene plus the choreographed share → server → resume flow; particles, bloom, and restrained light bands must explain that narrative rather than become generic decoration. No gradient buttons or interchangeable CSS blobs.
- **Mood:** The feeling of finding a thoughtful piece of work in a well-kept public index. Intimate, focused, and trustworthy; never corporate or clinical.
- **Differentiation:** Developer platforms default to undifferentiated gray dashboards or social-feed gloss. Spool's void palette and Paperboy electric blue frame technical work as something worth reading without disguising its provenance.

## Layout Philosophy

### Surface hierarchy

1. **Discovery** helps a visitor find a Session worth opening.
2. **Session pages** help a reader understand and continue the work.
3. **Projects** give related Sessions a durable, reader-facing home under a User or Team namespace.
4. **Profiles** establish authorship and collect a person’s Public Projects and Sessions.
5. **CLI** helps an author prepare, associate, share, publish, and manage Sessions.
6. **Teams** let members keep shared Projects and Sessions inside a named workspace before deciding whether the Team should publish it more broadly.

The public web must show the artifact before explaining the product. Real Sessions, authors, topics, and evidence carry more weight than feature illustrations.

### Public web

- **Header:** Compact and persistent on marketing and reading surfaces. The grouping rule is strict: the left side answers "where can I go" (Wordmark home + at most `Sessions` and `Projects`), the right side keeps exactly one primary action (`Publish`) plus one identity affordance (`Sign in` when signed out; the avatar menu when signed in). Search never appears in the header — it belongs inside the Sessions feed. `Docs` and `Blog` live with resource links. Theme, `My Sessions`, `Teams`, account, and sign-out live inside the avatar menu, never as parallel header icons. The homepage and resource pages never show a Session-language control: it belongs beside the bilingual Session content it changes. On mobile every retained action uses a 44px target.
- **Avatar menu:** The avatar opens a popover menu (`Account`, `Projects`, `My Sessions`, `Teams` — or the contextual `Team · {name}` shortcut — a theme toggle, and `Sign out`). It is navigation only; authorization still comes from the server.
- **Homepage:** Featured-first editorial layout for visitors and crawlers. Signed-in visitors who open `/` stay on the real homepage; `/sessions` remains their explicit workspace, and the wordmark never triggers a delayed auth redirect. The hero pairs a concise promise with one real featured Session—never a screenshot of the desktop app. Primary CTA is `Explore Sessions` (linking to `/sessions`); secondary CTA is `Share Yours`. Both are prominent 48px controls without directional-arrow decoration. Search stays compact until the public corpus is large enough to make search-first discovery useful.
- **Homepage feed:** Public Sessions appear immediately after the hero. Use information-rich rows or cards with author, agent, topic/project, Summary excerpt, evidence, and continuation state. Avoid equal-weight feature tiles.
- **Discovery:** One unified feed at `/sessions` with a scope switcher: `Public`, `Team · {name}` (one per membership), and `Mine`. Scope tabs render only after the server confirms membership — Team names never come from navigation state alone, and the Team scope is served `private, no-store` like every Team surface. `/explore` remains a compatibility redirect into `/sessions`. One content toolbar keeps the scope switcher and Session-language preference together at the top; Search and order controls sit directly below for Public. Agent identity stays visible on every Session as source metadata rather than a separate filter. The persistent product navigation is `Sessions`, `Projects`, `My Sessions`, and `Teams`; the wordmark alone returns home. Public results use exactly two orders: `Top` (global quality, useful evidence, qualified reading, and recency) and `Recent` (newest first). Do not label a global ranking `For you`, and do not expose a separate `Trending` tab. Results remain readable without opening each Session.
- **Projects:** A Project is a durable metadata home for related Sessions, owned by exactly one User or Team. It stores a name, URL-safe slug, short context-first description, and optional GitHub URL; it stores no repository content. Canonical identity follows the existing handle namespace as `/@handle/project-slug`. Personal Project metadata and its Public Sessions may be public. Team Projects remain `private, no-store`, resolve only for current members, and never leak into public Profile, Discovery, search, RSS, previews, or OG metadata. Project ownership never replaces Session authorship.
- **Profile:** Author identity and recurring topics come first, followed by Public Projects and Public Sessions. Counts support the content; they are not the hero.
- **Session page:** Summary establishes intent and outcome; conversation/tool activity shows process; files and diff show evidence; Resume/Fork is the primary action after reading. Source and continuation lineage remain visible.
- **Record fidelity:** Hub objects preserve validated provider JSON bytes, including key order, whitespace, and numeric lexemes. Local workspace and home paths are the only Share-time transform and use the reserved `$SPOOL_WS` / `$SPOOL_HOME` string tokens; Resume changes only provider Session identity fields and appends explicit lineage. Never describe parse/stringify reconstruction as byte-exact.
- **Visibility:** `Link-only`, `Team · {name}`, `Public`, and `Withdrawn` are explicit text labels with icons. Never communicate visibility by icon alone at the publishing boundary.
- **Alignment:** Editorial surfaces are predominantly left-aligned. A centered treatment is acceptable only for a short empty state or a focused search affordance—not as a substitute for public content.
- **Width:** Marketing and Discovery shells use a ~1120px max width. Reading columns stay near 720px; timeline/diff workbenches may expand to the full shell.

### Legacy desktop app (not distributed)

The Electron source remains only as legacy implementation reference while it is retired. It is not an installation or release target; new product flows must use the CLI and public web. The rules below describe existing legacy UI when maintenance or removal work touches it.

- **Core principle:** The desktop app is the author’s private preparation surface. Projects and Sessions are the home; search and publishing are actions within that context.
- **Shell:** Persistent left sidebar (240px) + main pane. Sidebar lists projects derived from `project_groups_v` and remains visible across every main-pane state.
- **Sidebar:** Neutral surface background, soft right border. Top-left wordmark `Spool.`, then a `PROJECTS` section label with a sort menu, then project rows. A divider separates derived projects from the always-last `Loose` entry.
- **Project row:** Display name on the left, faint source-color dots in the middle, monospace count on the right. Active and hover states use `surface2`.
- **Home:** Pinned Sessions above a recent feed bucketed by date. Entry to search is ⌘K or the top-right trigger.
- **Project view:** Recent feed of one project with sort and source filters. A `PINNED` segment surfaces project-pinned Sessions on top.
- **Session detail:** Opens as a main-pane state, not a modal. Share and Publish actions belong in the detail header.
- **Search overlay (⌘K):** Floats above the current main pane on a dimmed backdrop, scoped to `All` or the current project. Fast and AI modes share the same surface.
- **Width:** Window width ~960px; main-pane content stays near 720px; sidebar stays fixed at 240px.

### Shape

Border radius remains restrained: 10px for cards, 8px for inputs, 6px for rows and buttons, and 4px for badges. Pill radius is reserved for focused search inputs and compact toggles.

### Responsive shell contract

- **Phone (`320–640px`):** Product and marketing headers show the Wordmark, the current account action (`Sign in` or avatar), and one 44px navigation disclosure. `Sessions`, `Projects`, `Docs`, `Publish`, theme, and — signed in — `My Sessions` and `Teams` remain available inside that disclosure; do not compress the complete desktop header into one row. Session-language controls stay in the top content toolbar of Session-bearing pages, not in global navigation.
- **Compact (`641–768px`):** The same disclosure remains available so touch targets do not compete for width. Page content may use two columns only when each control still has its intended minimum width.
- **Desktop (`769px+`):** The full persistent navigation is visible. Marketing and Team shells remain capped near 1120px; account forms keep their narrower reading width.
- **Overflow invariant:** At 320, 451, 768, and 1024px, `scrollWidth` must not exceed the viewport. Long Team names, emails, badges, and action labels wrap, truncate, or move below identity instead of widening an ancestor.
- **Touch invariant:** Phone and compact navigation, form actions, and row actions use at least 44×44px targets. A 48px form control is allowed at every breakpoint and is preferred when aligned with text inputs.

### Button contract

Buttons express both hierarchy and state; page-level height or opacity patches are not a substitute for the shared primitive.

| Variant   | Purpose                                     | Default treatment                                      |
| --------- | ------------------------------------------- | ------------------------------------------------------ |
| `accent`  | One primary action in the current scope     | `--sp-accent-fill` blue + `--sp-on-accent` text        |
| `outline` | Secondary, reversible, or lower-priority    | Transparent fill + strong neutral border               |
| `ghost`   | Compact tertiary actions and navigation     | Transparent until hover/focus                          |
| `danger`  | Destructive membership or workspace changes | Error text/border; restrained error-tinted hover state |

- **Sizes:** `sm = 28px`, `md = 32px`, `lg = 48px`. Input-adjacent actions use `lg`; phone/compact adaptations raise any smaller actionable control to at least 44px.
- **Accent fill:** Buttons fill with `--sp-accent-fill` (light `#0B6BDB` + white ink; dark `#5BB1F0` + `#0B1520` ink), not the raw brand accent. `--sp-on-accent` maintains at least 4.5:1 against `--sp-accent-fill` in both themes. The brand `--sp-accent` (`#1387FF`/`#5BB1F0`) stays for links, text, icons, and borders — white text on light-mode `#1387FF` is only 3.5:1 and is never allowed.
- **Disabled:** Disabled buttons use neutral surface, border, and muted text tokens. Never lower the opacity of the entire button, and never leave faint text on an accent fill.
- **Loading:** Loading preserves the button’s hierarchy, swaps its leading icon for a spinner, sets `aria-busy="true"`, and blocks repeat submission. It does not visually collapse into the disabled treatment.
- **Danger:** Destructive styling belongs to the shared `danger` variant, not a page-specific red-text class.

### Social preview contract

- Marketing OG images are deterministic 1200×630 artifacts built from the same Geist, void, and Paperboy-blue tokens as the site.
- A brand or positioning change creates a new content-versioned pathname. Do not overwrite a long-lived OG URL or rely on query parameters: social crawlers cache preview assets independently of the page.
- A legacy preview pathname may remain only as a compatibility copy of the current artifact; canonical metadata always points at the content-versioned pathname.
- The homepage preview leads with the current product promise and `spool.new`; it must not carry legacy `spool.pro`, amber branding, or desktop-product screenshots.
- Session and Team privacy rules still apply: Public previews may describe the artifact and author; Team-only routes never emit Session or tenant OG metadata.

## Typography

- **Logo/Display:** Geist Sans 700 — large, tight letter-spacing (−0.04em), the period after "Spool" in accent color.
- **UI / Body:** Geist Sans 400/500/600 — readable at 11–15px, developer-native, not overused. Do NOT use Inter, Roboto, or system-ui as primary.
- **Fragment content:** Geist Mono 400/500 — all indexed content (conversation fragments, URLs, code) rendered in monospace. This visually separates "Spool UI" from "your content."
- **Counts / paths:** Geist Mono with `font-variant-numeric: tabular-nums`.
- **Loading:** Google Fonts CDN: `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap`

### Type Scale

| Role                                 | Size    | Weight  | Font                               |
| ------------------------------------ | ------- | ------- | ---------------------------------- |
| Marketing hero                       | 48–72px | 600     | Geist Sans, letter-spacing −0.04em |
| Public page title / Profile name     | 28–36px | 600     | Geist Sans, letter-spacing −0.02em |
| Session page title                   | 24–32px | 600     | Geist Sans, letter-spacing −0.02em |
| Desktop page title                   | 20px    | 600     | Geist Sans, letter-spacing −0.01em |
| Sidebar wordmark                     | 18px    | 700     | Geist Sans, letter-spacing −0.04em |
| Search input (⌘K overlay)            | 15px    | 400     | Geist Sans                         |
| Public Summary / marketing body      | 15–17px | 400     | Geist Sans                         |
| Search input (results page)          | 13px    | 400     | Geist Sans                         |
| Body / result actions                | 13px    | 400/500 | Geist Sans                         |
| Session content / fragments          | 12px    | 400     | Geist Mono                         |
| Runnable commands / docs code blocks | 14px    | 400/500 | Geist Mono                         |
| Secondary / meta                     | 11px    | 400/500 | Geist Sans                         |
| Labels / caps                        | 10px    | 600     | Geist Sans, letter-spacing 0.08em  |
| Badges / paths                       | 11px    | 500/600 | Geist Mono                         |

**Floor:** 11px for body / UI / meta text. Labels-and-caps may use 10px (small uppercase reads cleanly even below the body floor). No half-pixel sizes (12.5, 13.5) — they fight sub-pixel rendering.

## Color

- **Approach:** Restrained — one Paperboy blue accent over a black/white void palette; color is rare and meaningful.

### Light Mode

| Token           | Hex       | Usage                                                    |
| --------------- | --------- | -------------------------------------------------------- |
| `--bg`          | `#FFFFFF` | App background — pure white                              |
| `--surface`     | `#F5F5F5` | Cards, titlebar, status bar                              |
| `--surface2`    | `#ECECEC` | Hovered surfaces, mode pill background                   |
| `--border`      | `#E5E5E5` | Dividers, card borders                                   |
| `--border2`     | `#D4D4D4` | Input borders, focused-adjacent                          |
| `--text`        | `#0A0A0A` | Primary text                                             |
| `--muted`       | `#666666` | Secondary text, labels                                   |
| `--faint`       | `#A3A3A3` | Placeholder text, disabled state                         |
| `--accent`      | `#1387FF` | Primary accent — Paperboy wing blue (links, text, icons) |
| `--accent-fill` | `#0B6BDB` | Accent button/CTA fill; pairs with white `--on-accent`   |
| `--accent-bg`   | `#E7F2FF` | Accent-tinted backgrounds (selected state, AI answer)    |

### Dark Mode

| Token           | Hex       | Usage                                                |
| --------------- | --------- | ---------------------------------------------------- |
| `--bg`          | `#000000` | Void black                                           |
| `--surface`     | `#090909` | Cards, titlebar, status bar                          |
| `--surface2`    | `#111111` | Hovered surfaces                                     |
| `--border`      | `#1F1F1F` | Dividers                                             |
| `--border2`     | `#2E2E2E` | Input borders                                        |
| `--text`        | `#FFFFFF` | Primary text                                         |
| `--muted`       | `#A6A6A6` | Secondary text                                       |
| `--faint`       | `#555555` | Placeholder, disabled                                |
| `--accent`      | `#5BB1F0` | Accent brightened for dark — Paperboy blue           |
| `--accent-fill` | `#5BB1F0` | Accent button fill on dark; pairs with `#0B1520` ink |
| `--accent-bg`   | `#0E2740` | Accent backgrounds on dark                           |

### Source Badge Colors

Each agent source has a fixed color used consistently across badges, chips, and dots.
Only currently-supported agent sources are listed. Add a row when a new source ships; never add aspirational badges preemptively.

| Source      | Light     | Dark      |
| ----------- | --------- | --------- |
| Claude Code | `#C26A4E` | `#E89A7C` |
| Codex CLI   | `#4A9670` | `#7CC9A2` |
| Gemini      | `#5887D0` | `#8AB0E5` |
| OpenCode    | `#8A6F3D` | `#C9A761` |
| Pi          | `#A55A7A` | `#D88AAA` |

### Semantic States

Semantic colors are tuned for contrast against the void palette — never use Tailwind defaults (`green-500`, `red-500`).

| State                | Light                  | Dark      |
| -------------------- | ---------------------- | --------- |
| Success / synced     | `#6BAF6B` (warm green) | `#7DC07D` |
| Warning / stale      | `#E4A640` (warm amber) | `#F0B854` |
| Error / disconnected | `#E5484D`              | `#FF6369` |

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

- **Approach:** Minimal-functional on product surfaces. The homepage is the exception: its WebGL hero and share → server → resume sequence may use continuous, narrative motion to make cross-machine Session flow legible.
- **Homepage motion:** Theme-aware particles, bloom, and light bands must remain visually subordinate to the promise and CTAs. Respect `prefers-reduced-motion` with a stable composed frame and no essential information hidden behind animation timing.
- **⌘K overlay open/close:** Backdrop fades in (120ms), overlay card scales from 0.98 → 1 + fades in (140ms ease-out). Reverse on close.
- **Main-pane state changes (Library Home ↔ Project View ↔ Session Detail):** Instant. No slide or crossfade — sidebar context already tells the user where they are.
- **Results appear:** Fade + translate-y(4px) → 0. Duration 150ms, ease-out, staggered 20ms per item.
- **Mode switch (Fast ↔ AI):** Overlay content area crossfade 200ms.
- **Hover states:** Background 80ms, border-color 80ms — fast enough to feel instant.
- **Nothing else moves on product surfaces.** No scroll-driven animation in readers, Discovery, Profiles, desktop preparation, or account flows.

## UI States

### Discovery

- **Default:** A compact search field, `Top` / `Recent` order controls, and a feed of Public Sessions. Agent identity belongs in each result's source badge, not in a dedicated filter rail. Featured items may be editorially larger, but the rest of the feed uses one consistent information hierarchy.
- **Session result:** Author avatar + handle, locale-matched task-outcome title and Summary excerpt, agent/source badge, publication time, messages/tools, token cost, Star count, diffstat, and continuation state. Keep touched-file counts in machine evidence and ranking data, but do not spend feed-row space on a file count.
- **Empty query:** Show recent and featured Sessions, not an empty search page.
- **Empty search:** Explain that the query produced no results and offer one-click clearing.
- **Loading:** Preserve card/row geometry with neutral skeletons; do not replace the entire feed with a centered spinner.

### Profile

- **Header:** Avatar, display name, `@handle`, short bio, recurring topics/agents, and a restrained Session count.
- **Body:** Public Sessions only. Link-only Sessions never affect visible counts or empty-state wording.
- **Empty state:** “No public sessions yet.” Do not imply that the author has no local or Link-only work.

### Public Session

- **Header:** Author attribution, agent/source, `Public` label, publication time, and lineage when present.
- **First screen:** Summary and machine-derived evidence are visually separated. Summary is interpretive; files, diffstat, and tool activity are evidence.
- **Reading depth:** Summary → conversation/tool timeline → files/diff → record deep link.
- **Progressive history:** The Hub Summary, author, visibility, title, and available evidence render as soon as metadata arrives. A legacy raw conversation is an explicit `Load full session` action, fetched in small monotonic pages with honest record progress and partial content preserved; record-addressed deep links may start that load automatically. An attached curated `.spool` publication may load automatically because it is already the bounded reading projection.
- **Human guidance view:** Readers may switch from `Full session` to `Human guidance`. Human-authored prompts remain readable in full; each following agent turn collapses to one quiet row with accurate tool-call and Unicode-character counts. Opening that row shows only the corresponding visible agent prose in a modal. A provider-aware immutable guidance index fetches prompt records on view switch and reply records only when opened; it must not count tool results as calls, duplicate Codex response records, sidechains, or hidden `.spool` turns.
- **Primary continuation action:** one accent `Resume in [agent]` button that opens a clone-style popup (GitHub `Code` button pattern). The popup offers one command per situation — `Spool CLI installed` (`spool resume <sid>`) as the default tab, and `First time — install Spool` (install script + resume) one tab away — each with its own copy action. Never force the curl bootstrap inline on the page. Explain that resuming creates new work and leaves the source unchanged.
- **Stars and published forks:** Public Sessions expose a GitHub-style `Star` control and counts beside Resume. Stars require a signed-in viewer and are removed when the target leaves Public visibility. `Forks` is not a second write path: it counts direct descendants created through `spool resume`, verified by the server with the single-use Resume grant, that were later published and remain Public. A client-declared lineage may support legacy display, but never increments the public fork count; Team and Link-only descendants do not affect it either. These signals do not alter `Top` ranking in the first release.
- **Session titles and Summaries:** the reading surface prefers the summary-derived task title (what the Session accomplished), falling back to the first-prompt-derived label only for legacy Sessions. Titles are stored bilingually (`title` English, `title_zh` Simplified Chinese, ≤96 chars) and new Summary documents carry complete English and Simplified Chinese Markdown bodies. One locale snapshot selects title and Summary together. Each Summary must orient an unfamiliar technical reader with background, motivation, the concrete problem, work performed, validation, and outcome before project-local detail; it must not assume the reader already knows the conversation.
- **Session language:** A reader can switch explicitly between English and Simplified Chinese from a top content toolbar on Session-bearing surfaces. The homepage, Docs, legal pages, generic account pages, and global navigation do not show the control because those surfaces do not visibly change. The preference is available signed in or out, persists on the device, and applies atomically to Session titles, Summary bodies, and feed excerpts. It does not imply that product chrome has been fully translated.
- **Token cost:** when recorded usage exists, show the estimated API cost as quiet mono metadata (`$1.87 · 2.4M tokens`) beside publication facts — evidence, not a vanity metric. Costs are computed at publish time from a vendored model-pricing snapshot (LiteLLM-style, refreshed by editing the file); the read path never fetches pricing.
- **Link-only Session:** Same reader, but label it `Link-only` and exclude discovery navigation that implies public listing.
- **Withdrawn:** Keep a stable unavailable page with no leaked title, Summary, author, or content.

### Team workspace

- **Tenant model:** Each Team is a durable workspace, not a filter over personal content. Resource ownership and authorization come from the server; a client-side Team switcher is only navigation context.
- **Roles:** `Owner`, `Admin`, and `Member` are single, explicit roles. Owners manage the workspace and ownership; Admins manage members, invitations, and Team Sessions; Members can read Team Sessions and contribute their own. The last Owner cannot leave, be removed, or be demoted until ownership is transferred.
- **Creation:** Creating a Team immediately creates its WorkOS Organization membership and makes the creator an Owner. Show the durable Team name and membership state only after the complete operation succeeds.
- **Navigation:** The workspace sidebar exposes `Projects` as a first-class destination. Its `Teams` disclosure lists only server-confirmed memberships and links each name directly to `/teams/{id}`; mobile expands those children in the navigation menu. `/teams` is the focused `Create team` surface, not a second list-page hop. `/teams/{id}` uses route-addressable `Sessions`, `Projects`, `Members`, and `Settings` sections; Sessions and Projects default newest first. The global account menu may provide Team shortcuts, but must not imply that switching scope changes authorization.
- **Project assignment:** Every hosted Session belongs to exactly one Project in the same tenant. A personal Session belongs to its author's personal Project; a Team-owned Session belongs to a Project owned by that Team while preserving the individual author. Moving a Session between Projects never changes its records, visibility, authorship, stars, or verified-fork lineage. A Personal → Team ownership transfer selects the Team Project in the same atomic mutation.
- **CLI:** `spool share` and `spool subscribe` resolve the exact local Project of the selected Session, then require an explicit Hub Project binding. Interactive use may select or create a Project; non-interactive use fails closed without `--project` or an existing binding, and `--yes` never chooses a Project. Bindings are account-, tenant-, Hub-, and local-identity-specific. Re-sharing preserves the existing remote Project unless the author performs an explicit management move.
- **Members:** The Members surface shows identity, role, join state, and pending invitations. Invitations name their recipient and intended role; Owners/Admins can resend or revoke them. Destructive membership actions require explicit confirmation and explain the effect on access.
- **Session ownership:** Moving a personal Session into a Team is an ownership transfer. State that the Team keeps the Session if the author later leaves. Team Owners/Admins may manage Team-owned Sessions; attribution still names the original author while that identity exists.
- **Responsive layout:** At 320px, use one column and move row actions below identity/content; every interactive target is at least 44px. At 768px, two-column forms are allowed. Desktop may use a 240px Team rail plus a main column, within the 1120px shell.

### Team Session

- **Access:** `Team · {name}` means only current members can read it. It is genuinely private to the tenant, unlike `Link-only`, which remains readable by anyone with the URL.
- **Private response:** Team Session metadata, view, records, and attached `.spool` document all require the same membership gate and use `private, no-store`. A removed member loses access on the next request.
- **No public projection:** Team-only Sessions never enter Explore, Profile lists or counts, public search, engagement ranking, RSS, previews, or OG metadata. Anonymous server rendering must not reveal title, Summary, author, lineage, or evidence.
- **Reader state:** An anonymous visitor sees a sign-in affordance that preserves the intended URL. An authenticated non-member sees the same unavailable treatment as an unknown Session; do not reveal which Team owns it.
- **Disclosure changes:** Personal → Team, Team → Public, and Team → Link-only are named, confirmed actions. Public → Team immediately removes all public discovery and engagement projections before the change is reported complete.

### Publishing

- **Prepare:** Show exactly which Session and record range will be shared, secret findings, and optional Summary before network transfer.
- **Share complete:** Return the durable URL and state whether the Session is Public or Link-only. Supported Sessions are Public by default and can appear in Discovery.
- **Publish confirmation:** Explain that supported Sessions can appear in Discovery and search. Visibility is text + icon, never a globe icon by itself.
- **After publish:** Show `Public`, copy-link, view-profile, and withdraw actions. Never collapse Share and Publish into one ambiguous toggle.
- **Team target:** Team is an explicit optional target, never a sticky hidden default. Selecting it changes the confirmation to `Team · {name}` and explains that current members can read it and the Team owns the resulting Session.

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

CLI, account, and publishing flows may address the signed-in author directly where it adds signal:

- “This Session will be Public in Explore.”
- “Publish this Session?”
- “Nothing leaves this machine until you confirm.”
- “Withdrawn by you.”

In dense lists, prefer compact facts over repeated pronouns:

- ✅ `spool · today · 12 messages · sonnet-4`
- ❌ `You discussed this in spool · today · 12 messages · sonnet-4`

### Visibility copy

- `Link-only` means anyone with the URL can read it.
- `Public` means it may appear on the author’s Profile and in Discovery.
- `Team · {name}` means only current members of that Team can read it; the Team retains the Session when an individual member leaves.
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
- Introducing dark-mode surface values outside the documented void token scale (`#000000`, `#090909`, `#111111`)
- Inter, Roboto, or system fonts as primary UI typeface
- Emoji in production UI—replace all with vector icons

## Decisions Log

| Date       | Decision                                        | Rationale                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | Homepage is Featured-first                      | A real curated Session explains the product during community cold start; search gains prominence as the public corpus grows.                                                                                                                                                                                                                                                                                      |
| 2026-07-18 | Share and Publish are separate actions          | Superseded on 2026-07-20 by Public-by-default sharing for providers supported by Explore.                                                                                                                                                                                                                                                                                                                         |
| 2026-07-18 | New shares are Link-only                        | Superseded on 2026-07-20; unsupported providers still use this fallback.                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-20 | Supported Shares are Public by default          | There is no reliable second Publish flow yet; the Share confirmation is the explicit disclosure boundary and must name Explore visibility.                                                                                                                                                                                                                                                                        |
| 2026-07-18 | Public metadata is author-attributed            | Readers need to know whose work they are viewing; first-person language is reserved for the author’s own surfaces.                                                                                                                                                                                                                                                                                                |
| 2026-07-18 | Session pages show interpretation + evidence    | Summary helps orientation, while conversation, tools, files, and diff preserve trust and depth.                                                                                                                                                                                                                                                                                                                   |
| 2026-07-18 | Resume creates lineage, never mutation          | Continuation should be visible without changing the source Session.                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-18 | Warm amber remains the sole product accent      | Superseded on 2026-07-22: the accent is now Framer-derived electric blue on a void palette.                                                                                                                                                                                                                                                                                                                       |
| 2026-07-22 | Void palette + electric blue accent             | After a design-system exploration (open-design packages), the Warm Index structure keeps its layout while the palette moves to void black/white with the Paperboy wing blue `#1387FF`/`#5BB1F0` (post-acquisition brand color). The WebGL hero follows the active light/dark theme.                                                                                                                               |
| 2026-07-22 | Teams are durable tenant workspaces             | Team-only is a real authorization and ownership boundary, not a renamed link state. WorkOS carries organization identity and invitations; Spool enforces roles, storage ownership, disclosure, and public-projection isolation.                                                                                                                                                                                   |
| 2026-07-22 | CLI replaces the distributed desktop app        | Local preparation and continuation ship through the installed `spool` command; `/install.sh`, npm, GitHub releases, and production web advance as one CLI-first release train.                                                                                                                                                                                                                                    |
| 2026-07-23 | Web navigation is login-aware and continuous    | Landing, product, account, and publishing-guide surfaces keep `Explore`, `Docs`, and `Publish` discoverable while the right-side account action changes from `Sign in` to Teams plus the user avatar. Homepage CTAs use `Explore Sessions` and `Share Yours` without arrows.                                                                                                                                      |
| 2026-07-23 | Discovery owns the product workspace navigation | Supersedes the primary-Docs portion of the earlier navigation decision: the product rail is `Explore`, `My Sessions`, and `Teams`; the wordmark alone returns home; `Docs` moves beside legal/resource links. Explore exposes only honest global `Top` and chronological `Recent` orders, and Team Sessions default to a recent activity feed.                                                                    |
| 2026-07-24 | `--sp-accent-fill` owns button fills            | Near-black ink on `#1387FF` read as a rendering bug. Buttons now fill with `#0B6BDB` + white ink in light mode (5.07:1) while `#1387FF` stays the brand accent for links/text/icons; dark mode keeps `#5BB1F0` + `#0B1520` ink (7.87:1). White on light-mode `#1387FF` (3.5:1) remains forbidden.                                                                                                                 |
| 2026-07-24 | `/sessions` is the one feed with scopes         | `/explore` and `/teams` split one content type (a Session feed) across two surfaces. `/sessions` unifies them behind `Public` / `Team · {name}` / `Mine` scope tabs; `/explore` stays as a redirect; `/teams/{id}` keeps Members/Settings management. Scope tabs render only after the server confirms membership.                                                                                                |
| 2026-07-25 | Session scopes share one feed presentation      | Public, Team, and Mine use the same 1120px workspace shell and Session-row hierarchy. Agent source remains explicit per row, while the redundant Agent filter rail is retired; visibility changes and Withdraw stay available through quiet per-row management.                                                                                                                                                   |
| 2026-07-24 | Header keeps one action + one identity entry    | Left side: Wordmark plus at most `Sessions` and `Docs`. Right side: `Publish` plus `Sign in`/avatar. Search moved into the feed, `Blog` into the footer, and theme/`My Sessions`/`Teams`/sign-out into the avatar menu. The signed-in `/` redirect is superseded on 2026-07-25 so the wordmark always has a stable home.                                                                                          |
| 2026-07-24 | Session route map retired                       | The bezier "goal trail" on Session pages shipped before it was ready and read as noise; the timeline, prompts rail, and diff evidence already carry the reading depth. Remove rather than iterate in public.                                                                                                                                                                                                      |
| 2026-07-24 | Resume is a clone-style popup                   | One inline curl command punished users who already had the CLI. The accent `Resume in [agent]` trigger opens options per situation (installed → `spool resume`, first-time → install + resume), mirroring GitHub's Code button.                                                                                                                                                                                   |
| 2026-07-24 | Titles are bilingual task outcomes; cost shown  | The local summary agent emits front-matter (`title` en / `title_zh` zh, ≤96 chars) describing what the Session accomplished — never the first prompt. Readers get their locale's title. Token usage is aggregated at share time and priced from a vendored snapshot; `$ · tokens` renders as quiet mono evidence.                                                                                                 |
| 2026-07-25 | Wordmark home and Team shortcuts are literal    | The product wordmark always opens `/` without an auth redirect flash. Confirmed Team memberships expand directly in the workspace sidebar and navigate to `/teams/{id}`; `/teams` is creation-only, removing the redundant Team index hop.                                                                                                                                                                        |
| 2026-07-25 | Long raw history is explicitly progressive      | Metadata and Summary form the first screen. Legacy records load only on request (or a record deep link), in small batches with monotonic progress, partial rendering, and retry from the last received record; a curated `.spool` projection remains an automatic bounded read.                                                                                                                                   |
| 2026-07-25 | Stars are Public; forks require a Resume grant  | A signed-in viewer may Star a currently Public Session. Published fork counts include only direct, currently Public descendants whose `spool resume` lineage was verified by the server's single-use grant—not arbitrary client lineage, local resumes, or private children. Both disappear from public social state with the target's Public visibility, and neither changes `Top` ranking in the first release. |
| 2026-07-25 | Feed evidence favors cost and Stars             | Session feed rows retain messages, tools, diffstat, and provider evidence, but replace the low-value touched-file count with the immutable token-cost estimate and live Public Star count. File counts remain available in detailed evidence and ranking data.                                                                                                                                                    |
| 2026-07-25 | Summaries are bilingual and context-first       | A new Summary carries complete English and Simplified Chinese bodies beside bilingual task-outcome titles; locale selects both atomically. Each body first explains the system, motivation, and reader-relevant problem, then implementation, validation, and result. Legacy single-language bodies remain readable.                                                                                              |
| 2026-07-25 | Human guidance is a sparse reading projection   | Human prompts can be read without downloading the full raw Session. Provider-aware immutable guidance metadata counts call-side tools and visible reply characters, while prompt/reply records are fetched sparsely and agent prose opens on demand in an accessible modal.                                                                                                                                       |
| 2026-07-25 | Session language is an explicit reader choice   | Browser locale remains the first-visit default, but readers can switch English and Simplified Chinese from the persistent shell. The device preference controls bilingual titles, Summaries, and feed excerpts together; it is available signed in or out and does not claim full product-chrome localization.                                                                                                    |
| 2026-07-26 | Projects are hosted Session namespaces          | A Project is metadata, not a code host: exactly one User or Team owns its slug, description, optional GitHub link, and related Sessions. Every hosted Session has a same-tenant Project while retaining its individual author. Personal Projects use `/@handle/slug`; Team Projects remain member-only and never enter public projections.                                                                        |
| 2026-07-26 | Session language stays beside Session content   | Supersedes the persistent-shell placement above: the stored bilingual preference is unchanged, but its control appears only in the top content toolbar of Session feeds/readers/Project feeds. Marketing, resource, legal, account, and global navigation surfaces omit a switch that would have no visible effect.                                                                                               |
| 2026-07-18 | Geist Sans for chrome; Geist Mono for records   | The font split distinguishes product interface from authentic Session content, commands, paths, and URLs.                                                                                                                                                                                                                                                                                                         |
| 2026-07-18 | Icons follow adjacent-role sizing               | Local consistency within a row or toolbar matters more than a rigid global icon whitelist.                                                                                                                                                                                                                                                                                                                        |
