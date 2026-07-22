---
title: Installation
description: Install the Spool CLI once and use the spool command from any project.
---

Use the CLI to prepare, share, read, and resume agent Sessions. The installer supports macOS and Linux and requires Node.js 22.19 or newer with npm.

## Install the CLI

Run the installer once:

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Open a new terminal after the installer finishes, then verify that the command is available:

```bash
spool --version
spool doctor
```

After installation, use `spool` directly instead of downloading the package for each command.

## Sign in for sharing

The CLI uses a browser-approval flow that also works over SSH:

```bash
spool login
```

The terminal prints a short approval URL and waits for the browser confirmation.

## Local data and sharing

Session preparation happens locally. Running bare `spool` in a project refreshes the local index, signs in if needed, and starts a Share for that project’s latest Session. Nothing is uploaded until you review the disclosure boundary and confirm Share; supported Sessions are Public by default.

See [Quick Start](/docs/quick-start) to share your first Session.
