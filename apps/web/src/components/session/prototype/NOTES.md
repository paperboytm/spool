# PROTOTYPE — share session page UI (throwaway)

**Question:** What should the `/session/<sid>` share page look like?

Three structurally different variants, switchable via `?variant=` on the
existing route (the floating bottom bar and ←/→ arrow keys cycle them).
All data fetching stays in `session-reader.tsx`; the variants only swap
the rendered subtree. Everything is dev-only (`import.meta.env.DEV`).

## Run it

```sh
pnpm --filter @spool/web dev
```

Then open (no backend needed — `?mock=1` renders from a fixture):

- http://localhost:3002/session/claude_prototype-mock-01?mock=1 — current page
- http://localhost:3002/session/claude_prototype-mock-01?mock=1&variant=doc
- http://localhost:3002/session/claude_prototype-mock-01?mock=1&variant=bench
- http://localhost:3002/session/claude_prototype-mock-01?mock=1&variant=cover

Drop `?mock=1` to use a real shared session against a local backend.

## The variants

| Key | Name | Structure | Primary affordance |
|-----|------|-----------|--------------------|
| (none) | Current dossier | First-screen card → conversation + diff side-by-side | evidence appraisal |
| `doc` | Document | One centered reading column; title as H1, note as lede, evidence as a facts strip, diff in a slide-over drawer, resume as a fixed chip | reading |
| `bench` | Workbench | Full-width three-pane IDE: toolbar (identity + resume), left rail (note / prompts / files), center conversation, right diff pane | navigating / inspecting |
| `cover` | Cover card | Full-height hero (author, title, note pull-quote, stat row, resume CTA) → conversation and changes as sections below the fold | deciding to engage |

## Verdict

_(fill in before deleting: which variant won, which pieces were stolen
from the others, and why — then fold the winner into `session-reader.tsx`
and delete this directory.)_

## Cleanup checklist

- [ ] Delete `src/components/session/prototype/`
- [ ] Remove the three PROTOTYPE blocks in `src/pages/session-reader.tsx`
      (imports, `?mock=1` short-circuit, variant render switch + switcher)
