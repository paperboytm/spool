---
title: Quick Start
description: Get up and running with Spool in under 5 minutes.
---

After [installing Spool](/docs/installation), you're a few clicks away from a browsable library of every AI session on your machine.

## 1. Launch Spool

Open Spool from your Applications folder. It starts indexing your Claude Code, Codex CLI, Gemini CLI, Antigravity CLI, and OpenCode sessions automatically — new sessions become visible the moment they're written.

## 2. Browse your library

The left sidebar lists **projects** — derived from the working directories your agents ran in, so a project called `api-core` collects every Claude / Codex / Gemini / Antigravity session you ever opened from that repo. Click a project to see its sessions in the main pane.

The Library Home (the default main-pane view) shows your most recent sessions across **all** projects, bucketed by date.

## 3. Pin what matters

Hover any session row and click the pin icon. Pinned sessions surface at the top of:

- their owning project's view, and
- the global **Pinned** section on Library Home.

Pin replaces the older Star concept — same gesture, library-shaped semantics.

## 4. Search with ⌘K

Press **⌘K** anywhere in the app to open the search overlay. Search is scoped to the current project by default, or **All** to span the whole archive. Toggle to **AI** mode in the same overlay for synthesized answers backed by source fragments.

## 5. Search from your terminal

The bundled CLI runs the same search engine:

```bash
spool search "auth middleware"
spool list -n 10
spool show <uuid>
```

See the [CLI reference](/docs/reference/cli) for the full command set.

## What about platform data (Twitter, GitHub, Reddit, …)?

Bookmarks, stars, and saves live in **[Spool Daemon](/daemon/)** — a sibling app focused on capture sync. Once you install Daemon, its captures appear alongside Spool sessions in the same search box.
