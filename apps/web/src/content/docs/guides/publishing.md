---
title: Publishing Sessions
description: Prepare, share, and manage an agent Session safely.
---

Local preparation never exposes a Session. Share is the explicit disclosure boundary: the author chooses exactly which Session and record range to publish, reviews sensitive-data findings, and confirms before upload.

## Publish a Session

**Share** creates a durable URL. Claude Code and Codex CLI Sessions are Public and eligible for Explore and search by default. Providers not yet supported by Explore remain Link-only.

## Share from the terminal

```bash
npx @spool-lab/cli sync
npx @spool-lab/cli login
npx @spool-lab/cli share <session-uuid>
```

Useful options:

```bash
npx @spool-lab/cli share <uuid>@12            # share only the first 12 records
npx @spool-lab/cli share --summary "..."      # provide Summary Markdown directly
npx @spool-lab/cli share --no-agent-summary   # skip the local Agent offer
npx @spool-lab/cli share --spool-file x.spool # attach a curated document
```

Without a Session argument, Spool uses the latest Session in the current directory.

## Summary

A Summary is an optional Markdown overview attached to the Shared Session. It is interpretive, not authoritative. Session pages keep it visually separate from machine-derived evidence such as files, diff statistics, and tool activity.

In an interactive terminal, Spool can detect a local Claude Code or Codex CLI installation and ask it to draft the Summary. The Agent uses your existing local configuration.

## Sensitive-data gate

Before sharing, Spool checks the selected records for likely credentials, tokens, personal data, and absolute paths. Review every finding. `--yes` bypasses the interactive confirmation and should be reserved for controlled automation.

Sharing a prefix can reduce scope, but it is not a replacement for reviewing the selected content.

## Withdraw a share

```bash
npx @spool-lab/cli withdraw <session-id-or-url>
```

Withdrawal makes the URL unavailable. It cannot revoke copies that a reader already downloaded or cached, so treat every share as disclosure to its recipients.
