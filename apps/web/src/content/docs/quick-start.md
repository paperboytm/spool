---
title: Quick Start
description: Share an agent Session and let someone else continue it.
---

Install the CLI once, then turn a supported agent Session into a durable URL with one everyday command.

## 1. Install the CLI

Run the installer once:

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Open a new terminal after the installer finishes.

## 2. Share the latest Session

From the project whose Session you want to share, run:

```bash
spool
```

Bare `spool` refreshes the local index, opens browser sign-in if this machine needs a Hub credential, selects the latest Session in the current project, and starts the reviewed Share flow. Local indexing itself does not publish anything.

To choose a different Session explicitly:

```bash
spool sessions list -n 10
spool share <session-uuid>
```

`spool sessions list` uses the current project by default. Run `spool sessions list --all` to see recent Sessions
from every indexed project.

Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions can be shared. Native Resume currently supports Claude Code and Codex CLI shares.

## 3. Review before sharing

Spool shows what will be shared and scans the records for likely sensitive values before upload. The original Session remains authoritative.

After the Session is shared, Spool can ask a detected local Agent to draft an optional Summary using your existing provider settings. The Summary helps a reader understand the intent and outcome, but it remains interpretive.

## 4. Send the URL

A successful share returns a URL such as:

```text
https://spool.new/session/claude_…
```

Anyone with the URL can read the Shared Session without installing Spool. Claude Code and Codex CLI Shares are Public in Explore and search by default.

## 5. Continue the work

A reader with the CLI installed can create a new native Session from the shared point:

```bash
spool resume <session-url>
```

Resume never modifies the source. It creates new work and preserves the relationship back to the Shared Session.

## Next steps

- [Publishing Sessions](/docs/guides/publishing)
- [Reading and Resuming](/docs/guides/reading-resuming)
- [CLI reference](/docs/reference/cli)
