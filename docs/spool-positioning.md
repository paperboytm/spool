# Spool Product Positioning

> This document is the source of truth for product narrative, terminology, and public-facing messaging.

## One sentence

**Spool is the publishing platform for agent sessions.**

It turns work done with agents into readable, discoverable, and resumable artifacts that other people can learn from and continue.

## Category and entry point

The category is **agent sessions**. The initial entry point is coding agents such as Claude Code and Codex CLI, where sessions already contain valuable decisions, tool activity, and implementation history.

Spool is not defined by one agent vendor. A Session is the durable unit; the agent that produced it is metadata.

## The problem

People increasingly build with agents, but the work is difficult to share well:

- screenshots and pasted excerpts lose context;
- final code hides the reasoning, failed attempts, and tool activity that produced it;
- hand-written recaps are expensive and often omit the important details;
- a static transcript can be read, but it cannot be continued as agent-native work;
- useful sessions remain isolated on individual machines instead of becoming shared knowledge.

## The product loop

```text
Create locally → Review and Share publicly → Discover → Read → Resume / Fork
```

1. **Create locally** — the original Session is produced by the author’s agent and remains authoritative.
2. **Share** — after reviewing the exact Session boundary and sensitive-data findings, the author creates a durable URL. Claude Code and Codex CLI Sessions are Public and discoverable by default; unsupported providers remain Link-only. Nothing else on the author’s machine is exposed.
3. **Discover** — readers find Sessions through authors, topics, agents, projects, and editorial surfaces.
4. **Read** — Summary, conversation, tool activity, files, and diff make the work understandable at different depths.
5. **Resume / Fork** — a reader continues from the shared point in a new native Session. The source remains unchanged and lineage stays visible.

## Who it is for

### Authors

People who want to show how they worked with an agent, not only the final output. Publishing should require less effort than writing a separate case study.

### Readers

People looking for real examples, reusable workflows, implementation reasoning, and evidence of what an agent actually did.

### Continuers

People who want to take useful work into their own environment and continue it with an agent instead of recreating the context manually.

### Teams and communities

Groups that want agent work to become reviewable, teachable, and reusable shared knowledge.

## Product pillars

### Faithful

The original Session is authoritative. Summaries and presentation layers help readers navigate it but never replace or rewrite the source record.

### Legible

A Shared Session is more than a transcript dump. Readers can start with a concise Summary, inspect the conversation and tool activity, review touched files and net changes, and deep-link to a specific point.

### Discoverable

Public Sessions belong to authors, topics, projects, and agent ecosystems. Profiles and Discovery turn isolated work into a browsable body of knowledge.

### Resumable

A Shared Session is a starting point, not a dead document. Resume creates new work with explicit lineage instead of modifying the source.

### Safe by default

Nothing leaves the machine automatically. Share is the explicit disclosure boundary: supported Sessions are Public by default, and the confirmation names Explore visibility before upload. Secret detection, clear visibility labels, and withdrawal controls remain mandatory.

### Attributable

Every Public Session has an author, an originating agent, a publication time, and—when continued—a visible relationship between source and fork.

## Public identity and community

A Profile is a person’s public body of agent work. It should communicate:

- who the author is;
- what they build or explore with agents;
- which Sessions they have made Public;
- which agents, topics, and projects recur in their work;
- how other Sessions have continued or built on their work.

The community begins as a corpus, not an engagement feed. High-quality Sessions, strong retrieval, author identity, and lineage matter before likes, comments, follower counts, or algorithmic popularity.

## Visibility model

| State     | Accessible by URL | Appears on Profile | Appears in Discovery |
| --------- | ----------------- | ------------------ | -------------------- |
| Local     | No                | No                 | No                   |
| Link-only | Yes               | No                 | No                   |
| Public    | Yes               | Yes                | Yes                  |
| Withdrawn | No                | No                 | No                   |

The UI must never use “private” for a Link-only Session: anyone with the URL can read it.

## Messaging hierarchy

### Primary message

**Publish agent sessions people can actually use.**

### Supporting message

Share the full context, make the work understandable, and let others continue it in their own agent.

### Proof points

1. Real agent sessions, not reconstructed posts.
2. Summary, conversation, tools, files, and diff in one readable page.
3. Public Profiles and Discovery for finding useful work.
4. Native Resume / Fork with visible lineage.
5. Public-by-default for supported providers, with visibility stated before upload.

## Homepage narrative

### Hero

The homepage is Featured-first: pair the product promise with one real curated Public Session. Search remains compact until the public corpus is large enough to support search-first discovery.

**See how people actually work with agents.**

Spool is where people publish, discover, and continue agent sessions.

- Primary action: **Explore sessions**
- Secondary action: **Publish yours**

### Story order

1. Show real Public Sessions immediately.
2. Explain why a Session is richer than a screenshot or recap.
3. Demonstrate the reading layers: Summary → conversation/tools → files/diff.
4. Show author Profiles and topic-based Discovery.
5. Explain Resume / Fork and lineage.
6. Close with the publishing flow and its privacy boundary.

## Language rules

Use:

- agent session
- Shared Session
- Public Session
- Share by link
- Publish publicly
- Profile
- Discovery or Explore
- Resume or Fork
- source Session / continued from

Avoid:

- chat log
- transcript dump
- post
- upload
- social feed
- “private link”
- claims that nothing ever leaves the machine
- positioning Spool as only a search box, archive, or local-only utility

## Product boundaries

Spool does not host or restore a project’s complete codebase. Git remains authoritative for code; the Session remains authoritative for agent work.

Spool does not silently publish local work. Capturing a Session and publishing it are separate actions with an explicit boundary.

Spool does not modify a source Session when someone resumes it. Continuation always creates new work with lineage.
