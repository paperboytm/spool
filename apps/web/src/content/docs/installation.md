---
title: Installation
description: Run the Spool CLI with npx—no global install required.
---

Use the CLI to prepare, share, read, and resume agent Sessions. It runs anywhere its Node.js dependencies are supported.

## Run with npx

Run the CLI directly with npx. It downloads the package when needed, so no global install is required:

```bash
npx @spool-lab/cli --version
npx @spool-lab/cli doctor
```

If you prefer the shorter `spool` command, install it globally once:

```bash
npm install -g @spool-lab/cli
spool --version
```

## Sign in for sharing

The CLI uses a browser-approval flow that also works over SSH:

```bash
npx @spool-lab/cli login
```

The terminal prints a short approval URL and waits for the browser confirmation.

## Local data and sharing

Session preparation happens locally. Nothing is shared automatically. A Link-only URL is created only after you choose a Session and confirm the Share flow.

See [Quick Start](/docs/quick-start) to share your first Session.
