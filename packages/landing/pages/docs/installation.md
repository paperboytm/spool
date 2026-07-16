---
title: Installation
description: Install Spool on your machine.
---

Spool runs locally on macOS (Apple Silicon).

## Quick install

```bash
curl -fsSL https://spool.pro/install.sh | bash
```

This downloads the latest `.dmg` from GitHub Releases, mounts it, and copies `Spool.app` to `/Applications`.

## Requirements

- macOS on Apple Silicon (M1+)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or any ACP-compatible agent

## Verify installation

After installation, launch Spool from `/Applications` or Spotlight. The app will start indexing your Claude Code, Codex, Gemini CLI, Antigravity CLI, and OpenCode sessions automatically.

## Optional: install the CLI

The `spool` command-line interface is published separately on npm. Install it globally to search your library from any terminal:

```bash
npm install -g @spool-lab/cli
```

See the [CLI reference](/docs/reference/cli) for available commands.
