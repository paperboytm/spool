---
title: Reading and Resuming
description: Understand a Shared Session and continue it in your own agent.
---

A Spool Session page supports several reading depths. You can understand the result quickly, inspect the process when needed, and continue the work without recreating its context by hand.

## Read in layers

### Summary

The first screen explains the Session’s intent and outcome. A Summary may be written by the author or drafted by the author’s local Agent, so it is presented as interpretation rather than proof.

### Conversation and tools

The Session view preserves the user and assistant turns and recorded tool activity. This is where you can inspect decisions, failed attempts, commands, and implementation steps.

### Files and diff

Touched files and net diff provide machine-derived evidence of what changed during the Session. Use them to validate claims in the Summary and jump back to the relevant part of the conversation.

### Deep links

A record deep link opens a precise point in the Session with surrounding context. Deep links are useful for review comments, explanations, and provenance references.

## Read from the CLI

```bash
npx @spool-lab/cli show <session-id-or-url>        # first-screen overview
npx @spool-lab/cli show <session-id-or-url> --log  # record timeline
npx @spool-lab/cli show <session-id-or-url> --diff # composed net diff
npx @spool-lab/cli show <session-id-or-url>@r3     # one record
```

## Resume the Session

Run this directly with npx; no global install is required:

```bash
npx @spool-lab/cli resume <session-id-or-url>
```

Spool verifies the shared records, materializes a new provider-native Session, adds source context, and launches the supported agent.

Choose a workspace explicitly when needed:

```bash
npx @spool-lab/cli resume <url> --workspace ~/code/project
```

To prepare the Session without launching the agent:

```bash
npx @spool-lab/cli resume <url> --no-exec
```

## Continuation semantics

Resume always creates new work:

- the source Shared Session remains unchanged;
- the new Session gets its own provider identifier;
- the source relationship and resume point are preserved;
- code still comes from the workspace and Git, not from Spool.

A Shared Session can contain code fragments and tool output, but it is not a replacement for access to the project repository.
