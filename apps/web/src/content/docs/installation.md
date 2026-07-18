---
title: Installation
description: Install the Spool desktop app or CLI.
---

Spool currently publishes and resumes Claude Code and Codex CLI Sessions. The desktop app runs on macOS with Apple Silicon; the CLI runs anywhere its Node.js dependencies are supported.

## Desktop app

```bash
curl -fsSL https://spool.pro/install.sh | bash
```

The installer downloads the latest signed release and copies `Spool.app` to `/Applications`.

You can also download the release artifact directly from [GitHub Releases](https://github.com/spool-lab/spool/releases/latest).

### Requirements

- macOS on Apple Silicon (M1 or newer)
- at least one supported coding agent
- a spool.pro account to share Sessions

## CLI

Install the CLI globally:

```bash
npm install -g @spool-lab/cli
```

Verify it is available:

```bash
spool --version
spool doctor
```

The desktop app and CLI use the same local Session index.

## Sign in for sharing

Desktop sign-in opens the system browser. The CLI uses a browser-approval flow that also works over SSH:

```bash
spool login
```

The terminal prints a short approval URL and waits for the browser confirmation.

## Local data and publishing

Session preparation happens locally. Nothing is published automatically. A share is created only after you choose a Session and confirm the publishing flow.

See [Quick Start](/docs/quick-start) to publish your first Session.
