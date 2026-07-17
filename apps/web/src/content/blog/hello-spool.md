---
title: "Introducing Spool: The Missing Search Engine for Your Own Data"
description: "Why we built a local search engine for developers who think with AI — and how it works."
date: 2026-04-02
author: Yifeng
tags: [announcement, product]
---

If you use Claude Code, Codex, Gemini CLI, or any AI coding agent daily, you've accumulated hundreds of sessions. Each one contains decisions, debugging breakthroughs, architectural discussions — your best thinking, scattered across session files on your machine.

Spool makes all of that searchable.

## The problem

Your past agent sessions are gold. You've solved hard problems, explored trade-offs, and built up context that's invaluable for future work. But there's no good way to find any of it.

You can't grep through JSONL files and get useful results. You can't ask your agent "what did we discuss about caching last month?" because it has no memory across sessions.

## How Spool works

Spool watches your session directories in real time. Every conversation becomes searchable the moment it's written — no manual export, no copy-paste. All local, all on your machine.

For platform data — GitHub stars, Twitter bookmarks, Reddit saves — see [Spool Daemon](/daemon/), our sibling app focused on capture sync.

## What's next: agent-native search

The key insight: your coding agent is already the best search engine you have. It just needs access to your personal data.

We're building a `/spool` skill for Claude Code and a standalone CLI so your agent can search your past sessions and pull matching context directly into the current conversation. Ask it to "build on last month's auth discussion" and it will actually be able to.

## Try it

```bash
curl -fsSL https://spool.pro/install.sh | bash
```

Spool is open source and runs entirely on your machine. [Star us on GitHub](https://github.com/spool-lab/spool) if this resonates.
