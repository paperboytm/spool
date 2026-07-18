<!-- /autoplan restore point: /Users/claw/.gstack/projects/linkclaw-lab-spool/main-autoplan-restore-20260327-161821.md -->

# Plan: Local Google Layout Rebuild

## Problem

Spool's current renderer is a compact top-bar layout (Raycast-style) that doesn't match
DESIGN.md's "Local Google" philosophy. The search box must be **centered and large** when
idle (Google homepage feel), then transition to a compact top-bar when the user types.
Supporting concerns: fonts aren't loaded (falling back to system-ui), colors are cold
Tailwind neutrals instead of DESIGN.md's warm palette, and the status bar needs a redesign.

## Goals

1. **Home state:** Large centered "Spool." logo + tagline + pill search bar + source chips
2. **Results state:** Compact "S." wordmark + search bar move to top, filter tabs, results list
3. **Fonts:** Geist Sans + Geist Mono loaded offline-safe via fontsource npm packages
4. **Color tokens:** Warm palette from DESIGN.md as Tailwind `@theme` variables
5. **Mode toggle:** ⚡ Fast | 🤖 AI pill inside search bar (UI chrome only, not wired up)
6. **Status bar:** Redesigned — left: sync info; right: Sources ⊕

## Tech Context

- Electron + electron-vite, React 18 + StrictMode
- **Tailwind CSS v4** (`@import "tailwindcss"` + `@tailwindcss/vite` plugin — no config file)
  - Custom tokens go in `styles.css` via `@theme { }` block
- Renderer root: `packages/app/src/renderer/`
- Font strategy: fontsource npm packages (offline-safe, correct for Electron)

## Files to Modify

| File                                                       | Change                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/app/src/renderer/index.html`                     | No change needed (font via CSS import)                            |
| `packages/app/src/renderer/styles.css`                     | Add `@theme` warm tokens + Geist font-family + fontsource imports |
| `packages/app/src/renderer/App.tsx`                        | Dual-layout: `isHomeMode` flag, HomeView vs results layout        |
| `packages/app/src/renderer/components/SearchBar.tsx`       | Mode toggle pill, `variant` prop (home/compact)                   |
| `packages/app/src/renderer/components/StatusBar.tsx`       | New layout: sync info left, actions right                         |
| `packages/app/src/renderer/components/FragmentResults.tsx` | Add filter tabs (All · Claude · Codex)                            |
| `packages/app/src/renderer/components/RecentSessions.tsx`  | Replace with SourceChips grid on home idle                        |

## New Files

| File                                                | Purpose                                           |
| --------------------------------------------------- | ------------------------------------------------- |
| `packages/app/src/renderer/components/HomeView.tsx` | Centered logo + tagline + SearchBar + SourceChips |

## Implementation Steps

### Step 1 — Install fonts (fontsource)

```bash
pnpm add --filter @spool/app @fontsource-variable/geist @fontsource/geist-mono
```

### Step 2 — styles.css: tokens + font imports

```css
@import '@fontsource-variable/geist';
@import '@fontsource/geist-mono/latin-400.css';
@import '@fontsource/geist-mono/latin-500.css';
@import 'tailwindcss';

@theme {
  /* Warm palette */
  --color-warm-bg: #fafaf8;
  --color-warm-surface: #f4f4f0;
  --color-warm-surface2: #eeeee9;
  --color-warm-border: #e8e8e2;
  --color-warm-border2: #d8d8d0;
  --color-warm-text: #1c1c18;
  --color-warm-muted: #6b6b60;
  --color-warm-faint: #adadaa;
  --color-accent: #c85a00;
  --color-accent-bg: #fff3e8;
  /* Dark */
  --color-dark-bg: #141410;
  --color-dark-surface: #1c1c18;
  --color-dark-border: #2e2e28;
  --color-accent-dark: #f07020;
  /* Source badges */
  --color-src-claude: #6b5b8a;
  --color-src-codex: #1a6b3c;
  --color-src-twitter: #3a3a3a;
  --color-src-github: #555555;
  --color-src-youtube: #b22222;
  --color-src-gpt: #10a37f;

  /* Typography */
  --font-sans: 'Geist Variable', system-ui, sans-serif;
  --font-mono: 'Geist Mono', monospace;
}

:root {
  -webkit-font-smoothing: antialiased;
  font-family: var(--font-sans);
  background: #fafaf8;
  color: #1c1c18;
}
```

### Step 3 — App.tsx: dual-layout

```tsx
const isHomeMode = !query.trim() && view === 'search'

return (
  <div className="flex flex-col h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-[#F2F2EC]">
    {/* Drag region — always present at top */}
    <div onMouseDown={handleHeaderMouseDown} className="flex-none h-10 shrink-0 z-20" />

    {isHomeMode ? (
      <HomeView query={query} onChange={handleQueryChange} />
    ) : (
      <>
        {/* Compact results topbar */}
        <div className="flex items-center gap-3 px-4 pb-3 -mt-10 relative z-10">
          <span className="text-base font-bold tracking-tight flex-none select-none">
            S<span className="text-accent">.</span>
          </span>
          <SearchBar
            query={query}
            onChange={handleQueryChange}
            onBack={view === 'session' ? handleBack : undefined}
            isSearching={isSearching}
            variant="compact"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {view === 'session' && selectedSession ? (
            <SessionDetail sessionUuid={selectedSession} />
          ) : (
            <FragmentResults results={results} query={query} onOpenSession={handleOpenSession} />
          )}
        </div>
      </>
    )}

    <StatusBar syncStatus={syncStatus} />
  </div>
)
```

Key detail: the drag region is `h-10` and `z-20`. In home mode, HomeView renders below it
(centred in the remaining space). In results mode, the topbar overlaps the drag region
using `-mt-10` so the search bar sits in the same visual row as the drag region.

### Step 4 — HomeView.tsx (new component)

```tsx
export default function HomeView({ query, onChange }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-10 gap-0 -mt-10">
      <h1 className="text-[48px] font-bold tracking-[-0.04em] leading-none mb-2">
        Spool<span className="text-accent">.</span>
      </h1>
      <p className="text-sm text-warm-muted mb-8">A local search engine for your thinking.</p>
      <div className="w-full max-w-[520px] mb-5">
        <SearchBar query={query} onChange={onChange} isSearching={false} variant="home" />
      </div>
      <SourceChips />
    </div>
  )
}
```

`-mt-10` on HomeView compensates for the 40px drag region so the content is truly
centered in the full window height.

### Step 5 — SearchBar.tsx: variant prop + mode toggle

Two variants:

- `variant="home"`: pill shape, 15px text, 12px vertical padding, shadow, max-w used by parent
- `variant="compact"`: pill shape, 13.5px text, 7px vertical padding, no shadow

Mode toggle pill (right side of both variants):

```tsx
<div
  className="flex bg-warm-surface dark:bg-dark-surface border border-warm-border
                rounded-full p-0.5 gap-0.5 flex-shrink-0"
>
  <button
    className="px-2.5 py-1 rounded-full text-[11px] font-medium
                     bg-warm-bg text-warm-text shadow-sm"
  >
    ⚡ Fast
  </button>
  <button
    className="px-2.5 py-1 rounded-full text-[11px] font-medium
                     text-warm-muted"
  >
    🤖 AI
  </button>
</div>
```

Note: ⚡ and 🤖 are **placeholder icons only** — per DESIGN.md, production icons will be
Lucide SVGs. The mode toggle is UI chrome only — no state wired up yet.

### Step 6 — SourceChips (inside HomeView)

```tsx
// Hard-coded with real data from status when available, else placeholder counts
const SOURCES = [
  { id: 'claude', label: 'Claude Code', color: '#6B5B8A' },
  { id: 'codex', label: 'Codex CLI', color: '#1A6B3C' },
]
// Rendered as pill chips with colored dot + label + count
```

Sources beyond Claude/Codex are out of scope until connector plugin integration lands.
The "+ Connect" chip is rendered as a dashed-border placeholder.

### Step 7 — StatusBar redesign

```tsx
<div
  className="flex-none h-[30px] bg-warm-surface dark:bg-dark-surface
                border-t border-warm-border flex items-center justify-between px-4"
>
  <div className="flex items-center gap-1.5">
    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
    <span className="text-[11px] font-mono text-warm-muted">
      {statusText} · {totalSessions} sessions
    </span>
  </div>
  <div className="flex items-center gap-3">
    <button className="text-[11px] text-warm-faint hover:text-warm-text">Sources ⊕</button>
  </div>
</div>
```

`⊕` is a placeholder — replace with Lucide SVG icon when icons are added.

### Step 8 — FragmentResults: filter tabs

```tsx
const sources = [...new Set(results.map((r) => r.source))]
const [activeFilter, setActiveFilter] = useState('all')
const filtered = activeFilter === 'all' ? results : results.filter((r) => r.source === activeFilter)
```

Filter tabs rendered above the results list. Active tab has amber bottom border.

## NOT In Scope

- AI mode functionality (ACP integration) — Phase 2 product feature
- URL Capture panel — Phase 2 product feature
- Sources management panel — Phase 2 product feature
- Animated search bar position transition (complex, deferred — crossfade is sufficient)
- Twitter/GitHub/YouTube source chips on home (no data source yet)
- `/spool` CLI skill integration

## Deferred

- `ContinueActions.tsx`: needs `window.spool?.` guards (ISSUE-001 already fixed the critical ones; `copyFragment` and `resumeCLI` still unguarded — low priority, only fires on user action)

## What Already Exists

| Sub-problem        | Existing code                                                              |
| ------------------ | -------------------------------------------------------------------------- |
| Drag region        | `App.tsx:20` — `handleHeaderMouseDown` + `useEffect` for mousemove/mouseup |
| Search state       | `App.tsx:14-19` — `query`, `results`, `view`, `isSearching`, `syncStatus`  |
| IPC search         | `App.tsx:46-59` — `doSearch` + debounce in `handleQueryChange`             |
| Session navigation | `App.tsx:67-74` — `handleOpenSession` + `handleBack`                       |
| Status data        | `StatusBar.tsx:12-14` — fetches via `window.spool.getStatus()`             |
| Fragment display   | `FragmentResults.tsx` — full component, just needs filter tabs             |
| Continue actions   | `ContinueActions.tsx` — full component, copy + resume + view               |

## Risk Factors

1. **Tailwind v4 `@theme` syntax** — slightly different from v3 (`theme.extend`). Must use
   `--color-*` prefix for colors, `--font-*` for fonts. Arbitrary values still work as fallback.

2. **`-mt-10` trick for drag region overlap** — fragile if drag region height changes. Alternative:
   use `position: absolute` for the drag strip so it doesn't affect document flow.

3. **fontsource package names** — `@fontsource-variable/geist` exists; `@fontsource/geist-mono`
   may need verification. Fallback: use Google Fonts CDN link in `index.html` (requires internet).

4. **`RecentSessions` component** — currently shows session list when idle. In new design,
   home mode shows source chips instead. The component can be deleted or repurposed.
   Session list is only visible when in results mode (no query but navigated to session view).

---

## Plan Amendments (from /autoplan review)

These amendments update the implementation steps above. Implement these **instead of** the
original spec where they conflict.

### AMD-1: Drag strip — position:absolute (replaces -mt-10 everywhere)

**Affects:** Step 3 (App.tsx), Step 4 (HomeView.tsx)

The `-mt-10` trick was flagged by all three reviewers (CEO, Design, Eng) as fragile.
Use `position: absolute` for the drag strip instead so it doesn't affect document flow.

```tsx
{
  /* Drag strip — position:absolute so it doesn't push content down */
}
;<div onMouseDown={handleHeaderMouseDown} className="absolute top-0 left-0 right-0 h-10 z-20" />

{
  isHomeMode ? (
    <HomeView query={query} onChange={handleQueryChange} />
  ) : (
    <>
      {/* Compact results topbar — starts at top, no -mt-10 needed */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-3 relative z-10">...</div>
      ...
    </>
  )
}
```

HomeView no longer needs `-mt-10` to compensate — it's centered in the full `h-screen`
because the drag strip is removed from document flow:

```tsx
// HomeView: remove -mt-10, just center normally
<div className="flex-1 flex flex-col items-center justify-center px-8 pb-10 gap-0">
```

### AMD-2: Remove mode toggle pill

**Affects:** Step 5 (SearchBar.tsx)

The mode toggle (⚡ Fast / 🤖 AI) is not wired to any functionality and ships as dead UI.
Remove it entirely from both variants. The clear button (✕) stays on the right side.
AI mode can be added in Phase 2 when ACP integration lands.

### AMD-3: isHomeMode condition fix

**Affects:** Step 3 (App.tsx)

The original condition has a hole: user navigates session→back while on home state (no query)
but `selectedSession` is still set briefly, causing a flash.

```tsx
// Correct condition — all three must be true for home state
const isHomeMode = !query.trim() && view === 'search' && !selectedSession
```

### AMD-4: SourceChips — live IPC counts

**Affects:** Step 6 (SourceChips inside HomeView)

Hard-coded source counts are misleading. Pass real counts from `window.spool.getStatus()`.
App.tsx already fetches status; thread counts down as props:

```tsx
// App.tsx — derive from existing status fetch
<HomeView
  query={query}
  onChange={handleQueryChange}
  claudeCount={status?.claudeSessions ?? null}
  codexCount={status?.codexSessions ?? null}
/>

// HomeView passes to SourceChips
<SourceChips claudeCount={claudeCount} codexCount={codexCount} />

// SourceChips renders count as "123" or "…" while loading
```

### AMD-5: Crossfade transition spec

**Affects:** Step 3 (App.tsx layout switch)

Wrap both layouts in a container that crossfades on `isHomeMode` change:

```tsx
// Wrap each layout branch — React key causes re-mount but opacity fade handles the jarring snap
<div key={isHomeMode ? 'home' : 'results'}
     className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-150">
```

Tailwind v4 built-in `animate-in`/`fade-in` from `tailwindcss-animate` if installed, else
add to `@theme`: `--animate-fade-in: fadeIn 150ms ease-out`.

### AMD-6: Focused state spec for SearchBar

**Affects:** Step 5 (SearchBar.tsx)

Focused input gets `ring-2 ring-accent/30` (already in original spec via `focus:ring-2`).
In `variant="home"`, also add subtle shadow elevation: `focus-within:shadow-md`.
No border color change — ring is sufficient.

### AMD-7: Empty results → warm palette

**Affects:** FragmentResults.tsx (empty state, line 13-21)

Replace `text-neutral-400` with `text-warm-faint` and `bg-neutral-100` with `bg-warm-surface`.

### AMD-8: Filter tab appearance spec

**Affects:** Step 8 (FragmentResults.tsx)

```tsx
// Tab bar — sits above divider
<div className="flex gap-0 border-b border-warm-border px-4">
  {['all', ...sources].map((src) => (
    <button
      key={src}
      onClick={() => setActiveFilter(src)}
      className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
        activeFilter === src
          ? 'border-accent text-warm-text'
          : 'border-transparent text-warm-muted hover:text-warm-text'
      }`}
    >
      {src === 'all' ? 'All' : src}
    </button>
  ))}
</div>
```

---

## GSTACK REVIEW REPORT

| Review           | Trigger   | Runs | Status | Key Findings                                                              |
| ---------------- | --------- | ---- | ------ | ------------------------------------------------------------------------- |
| CEO/Strategy     | /autoplan | 1    | DONE   | C1: remove mode toggle; C4: SourceChips need live IPC; C6: -mt-10 fragile |
| Design/UX        | /autoplan | 1    | DONE   | D1: add focused state spec; D3: -mt-10 fragile; D5: add crossfade spec    |
| Eng/Architecture | /autoplan | 1    | DONE   | E1: -mt-10 dead zone; E2: isHomeMode hole; E8: SourceChips duplicate IPC  |

### Decision Audit Trail

| ID  | Issue                                   | Severity | Decision                                            | Principle                |
| --- | --------------------------------------- | -------- | --------------------------------------------------- | ------------------------ |
| C1  | Mode toggle is dead UI                  | Critical | REMOVE (AMD-2)                                      | P5: explicit over clever |
| C2  | No success metric                       | High     | NOTE: home→results on first keystroke               | P1: completeness         |
| C3  | Power users may skip home state         | High     | ACCEPT — home valuable for first-run                | P6: bias toward action   |
| C4  | SourceChips hard-coded counts           | High     | FIX (AMD-4)                                         | P1: completeness         |
| C5  | Home→results transition jarring         | Medium   | FIX (AMD-5) crossfade                               | P1: completeness         |
| C6  | -mt-10 fragile                          | Medium   | FIX (AMD-1) position:absolute                       | P5: explicit             |
| C7  | DESIGN.md CDN contradiction             | Medium   | ACCEPT — plan uses fontsource (correct)             | P3: pragmatic            |
| D1  | Focused state unspecified               | Critical | FIX (AMD-6)                                         | P1: completeness         |
| D2  | Empty results uses cold neutrals        | Critical | FIX (AMD-7)                                         | P1: completeness         |
| D3  | -mt-10 centering fragile                | High     | FIX (AMD-1)                                         | P5: explicit             |
| D4  | StatusBar loading state unspecified     | High     | ACCEPT — existing "Loading…" text sufficient        | P3: pragmatic            |
| D5  | Transition unspecified                  | High     | FIX (AMD-5)                                         | P1: completeness         |
| D6  | Dark mode token coverage                | High     | ACCEPT — @theme covers dark tokens; verify at build | P3: pragmatic            |
| D7  | Source chip zero-count behavior         | Medium   | ACCEPT — show "0", don't hide                       | P3: pragmatic            |
| D8  | Filter tab appearance                   | Medium   | FIX (AMD-8)                                         | P1: completeness         |
| D9  | S. wordmark tracking                    | Medium   | ACCEPT — tracking-[-0.04em] already in plan spec    | P3: pragmatic            |
| E1  | -mt-10 dead z-index zone                | High     | FIX (AMD-1)                                         | P5: explicit             |
| E2  | isHomeMode session-from-home hole       | High     | FIX (AMD-3)                                         | P1: completeness         |
| E3  | @theme --color-dark-* naming            | High     | ACCEPT — valid Tailwind v4 pattern                  | P3: pragmatic            |
| E4  | HomeView -mt-10 centering               | Medium   | FIX (AMD-1)                                         | P5: explicit             |
| E5  | StatusBar detail panel removed silently | Medium   | NOTE — intentional scope reduction, logged          | P5: explicit             |
| E6  | Mode toggle overlaps clear button       | Medium   | MOOT — mode toggle removed (AMD-2)                  | P5: explicit             |
| E7  | @fontsource import paths                | Low      | NO_ACTION — paths verified valid                    | —                        |
| E8  | SourceChips duplicate IPC call          | Low      | FIX (AMD-4) — pass as props                         | P3: pragmatic            |

**VERDICT:** 8 amendments incorporated. All 24 findings resolved. Plan is implementation-ready.
