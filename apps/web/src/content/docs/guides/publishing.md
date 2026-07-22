---
title: Publishing Sessions
description: Prepare, share, and manage an agent Session safely.
---

Local preparation never exposes a Session. Share is the explicit disclosure boundary: the author chooses exactly which Session and record range to publish, reviews sensitive-data findings, and confirms before upload.

## Publish a Session

**Share** creates a durable URL. Claude Code and Codex CLI Sessions are Public and eligible for Explore and search by default. Providers not yet supported by Explore remain Link-only.

That is the initial visibility chosen by the CLI Share flow. After sharing, sign in to [your account](/me) to keep the Session Public or Link-only, or move it into a Team.

## Share with a Team

Create or open a Team from [your account](/me), then choose `Team · name` for a Session. Moving it transfers control of the hosted Spool asset to that Team and removes it from Explore and public Profile surfaces. Only current Team members can read a Team-only Session.

The Team keeps that hosted asset if the original author later leaves or deletes their account. Team Owners and Admins can change a Team-owned Session to Public or Link-only; Spool asks for confirmation because either choice discloses the Session outside the Team.

The three shared visibility levels are:

- **Public** — anyone can read; the Session may appear in Explore, search, and Profiles.
- **Link-only** — anyone with the URL can read; the Session is not listed on public discovery surfaces.
- **Team-only** (`Team · name`) — only current members of that Team can read.

## Share from the terminal

Install the CLI once:

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Open a new terminal, then run the everyday flow from the project:

```bash
spool
```

Bare `spool` refreshes the local index, signs in if needed, and starts a Share for the latest Session in the current directory. Use `spool share` to choose a different Session or pass options.

Useful options:

```bash
spool share <uuid>@12             # share only the first 12 records
spool share --no-agent-summary    # skip the local Agent offer
spool share --spool-file x.spool  # attach a curated document
```

Without a Session argument, `spool share` uses the latest Session in the current directory.

## Summary

A Summary is an optional Markdown overview attached to the Shared Session. It is interpretive, not authoritative. Session pages keep it visually separate from machine-derived evidence such as files, diff statistics, and tool activity.

In an interactive terminal, share the Session without a Summary flag. After the URL is live, Spool can detect a local Claude Code or Codex CLI installation and ask it to draft the Summary using your existing local configuration.

`--summary <markdown>` is an advanced manual or automation input. It uploads exactly the Markdown supplied by the caller; it does not ask an Agent to generate a Summary.

## Sensitive-data gate

Before sharing, Spool checks the selected records for likely credentials, tokens, personal data, and absolute paths. Review every finding. `--yes` bypasses the interactive confirmation and should be reserved for controlled automation.

Sharing a prefix can reduce scope, but it is not a replacement for reviewing the selected content.

## Withdraw a share

```bash
spool withdraw <session-id-or-url>
```

Withdrawal immediately makes the current URL return `410 Gone`. It cannot revoke copies that a reader or Team member already downloaded or cached, so treat every share and visibility change as disclosure to its recipients.

Personal owners can also Withdraw from the Session row on [their account](/me). Changing visibility cannot restore that hosted copy, but the author can later explicitly Share the same Session again. For a Team-owned Session, an Owner or Admin can Withdraw from the Team workspace. Team withdrawal is permanent: the Session leaves the management list, every audience loses access, and no member can revive it by submitting another Session head.
