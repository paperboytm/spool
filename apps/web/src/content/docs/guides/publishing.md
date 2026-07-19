---
title: Publishing Sessions
description: Prepare, share, and manage an agent Session safely.
---

Spool treats publishing as an explicit boundary. Local preparation never exposes a Session; the author chooses exactly which Session and record range to share.

## Share publicly

**Share** creates a durable public URL. After the author reviews the selected records and confirms the disclosure, the Shared Session can appear in Explore and search. There is no separate Publish step in this release.

## Share from Desktop

1. Open a Claude Code or Codex CLI Session.
2. Choose **Share session** from the Session actions.
3. Review the record count, file and diff summary, and sensitive-data findings.
4. Edit the optional Summary.
5. Confirm that the Session will be public and can appear in Explore and search, then copy the returned URL.

The desktop flow automatically attaches a curated `.spool` document when the Session can be rendered that way.

## Share from the CLI

```bash
spool sync
spool login
spool share <session-uuid>
```

Useful options:

```bash
spool share <uuid>@12            # share only the first 12 records
spool share --summary "..."      # provide Summary Markdown directly
spool share --no-agent-summary   # skip the local Agent offer
spool share --spool-file x.spool # attach a curated document
```

Without a Session argument, Spool uses the latest Session in the current directory.

## Summary

A Summary is an optional Markdown overview attached to the Shared Session. It is interpretive, not authoritative. Session pages keep it visually separate from machine-derived evidence such as files, diff statistics, and tool activity.

In an interactive terminal, Spool can detect a local Claude Code or Codex CLI installation and ask it to draft the Summary. The Agent uses your existing local configuration.

## Sensitive-data gate

Before publishing, Spool checks the selected records for likely credentials, tokens, personal data, and absolute paths. Review every finding. `--yes` bypasses the interactive confirmation and should be reserved for controlled automation.

Sharing a prefix can reduce scope, but it is not a replacement for reviewing the selected content.

## Withdraw a share

```bash
spool withdraw <session-id-or-url>
```

Withdrawal makes the URL unavailable. It cannot revoke copies that a reader already downloaded or cached, so treat every share as disclosure to its recipients.
