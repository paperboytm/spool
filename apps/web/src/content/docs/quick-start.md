---
title: Quick Start
description: Share an agent Session and let someone else continue it.
---

With the desktop app or the no-install CLI path from [Installation](/docs/installation), you can turn a Claude Code or Codex CLI Session into a durable URL in a few minutes.

## 1. Prepare your Sessions

Launch the desktop app, or index from the terminal:

```bash
npx @spool-lab/cli sync
```

Spool reads supported agent Session files on your machine and groups them by project. This preparation step is local; it does not publish anything.

## 2. Sign in

Sign in from Desktop, or run:

```bash
npx @spool-lab/cli login
```

The CLI opens a browser-approval flow and stores a revocable Hub credential on this machine.

## 3. Choose a Session

In Desktop, open a Session and choose **Share session**.

From the CLI, find a Session and share it:

```bash
npx @spool-lab/cli list -n 10
npx @spool-lab/cli share <session-uuid>
```

`npx @spool-lab/cli list` uses the current project by default. Run `npx @spool-lab/cli list --all` to see recent Sessions
from every indexed project.

Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions can be shared. Native Resume currently supports Claude Code and Codex CLI shares.

## 4. Review before sharing

Spool shows what will be shared, scans the records for likely sensitive values, and prepares an optional Summary. The Summary helps a reader understand the intent and outcome, but the original Session remains authoritative.

For a CLI share, Spool can ask a detected local Agent to draft the Summary with your own provider and authentication settings.

## 5. Send the URL

A successful share returns a URL such as:

```text
https://spool.pro/session/claude_…
```

Anyone with the URL can read the Link-only Shared Session without installing Spool. Publishing it to a Profile, Explore, and search remains a separate action.

## 6. Continue the work

A reader can create a new native Session from the shared point without a global install:

```bash
npx @spool-lab/cli resume <session-url>
```

Resume never modifies the source. It creates new work and preserves the relationship back to the Shared Session.

## Next steps

- [Publishing Sessions](/docs/guides/publishing)
- [Reading and Resuming](/docs/guides/reading-resuming)
- [CLI reference](/docs/reference/cli)
