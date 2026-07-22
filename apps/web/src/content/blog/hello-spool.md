---
title: 'Agent Sessions Should Be Publishable'
description: 'Why agent work needs a readable, discoverable, and resumable public format.'
date: 2026-04-02
author: Yifeng
tags: [announcement, product]
---

People increasingly build software with coding agents, but the work itself is hard to share.

A pull request shows the resulting code. A screenshot shows a moment. A recap tells the version someone remembered to write down. None of them preserve the complete path: the prompt that set the direction, the decisions made along the way, the commands and tools the agent used, the failed attempts, and the context someone else would need to continue.

Spool makes the agent Session a first-class publishing format.

## A Session is a work artifact

An agent Session contains more than conversation. It records intent, reasoning, tool activity, implementation details, and often the most useful explanation of why the final code looks the way it does.

Publishing that Session should not mean dumping an unreadable log. A Spool page lets a reader begin with a Summary, inspect the conversation and tools, review files and net changes, and deep-link to the exact moment that matters.

The original Session remains authoritative. The Summary helps orientation; the evidence remains available underneath it.

## Reading should lead to continuation

The most useful technical material often makes you want to try it yourself.

A Spool URL is both a page and a continuation point. With the CLI, a reader can resume the shared records as a new native Session in a supported coding agent. The source stays unchanged, and the relationship between source and continuation remains visible.

```bash
npx @spool-lab/cli resume <session-url>
```

## Public work needs identity and discovery

Useful Sessions should not disappear after a link is sent once. Public Sessions belong on author Profiles and in Discovery surfaces organized around topics, projects, agents, and the work itself.

That community starts with a high-quality public corpus—not vanity metrics. Authorship, evidence, search, and continuation lineage matter before likes or follower counts.

## Publishing must be explicit

Agent Sessions can contain credentials, personal data, local paths, and code that was never meant to leave a machine.

Spool keeps the boundary clear:

- local preparation does not publish anything;
- Share publishes supported Sessions to Discovery by default after an explicit review and confirmation;
- sensitive-data findings appear before disclosure;
- an author can withdraw a Shared Session.

## Try the current sharing flow

```bash
npx @spool-lab/cli sync
npx @spool-lab/cli login
npx @spool-lab/cli share <session-uuid>
```

No global install is required. If you prefer the shorter `spool` command, install it once with
`npm install -g @spool-lab/cli`.

Spool is open source and being built in public. [Follow the repository on GitHub](https://github.com/paperboytm/spool) if agent work deserves a better public format.
