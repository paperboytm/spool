# Spool Design

> 中文版：[spool-design.zh-CN.md](./spool-design.zh-CN.md)

## 1. In One Sentence

Git stores code history in `.git`. Each commit points to a code tree. On checkout, Git restores that tree into the working directory.

Spool does the same thing, but stores agent sessions instead of code.

```text
Git commit
├── tree <oid>             → code at that point
└── spool-snapshot <oid>   → sessions at that point
```

The commit stores only the address of a session snapshot. Session bodies remain in Spool's own object store.

Each commit therefore answers two questions:

- What was the code at that point?
- How far had the related sessions progressed?

### 1.1 Spool CLI

Spool is a new CLI built on Git semantics and its object model. The main user entry points are:

```bash
spool init
spool commit
spool checkout <commit-ish>
spool push <remote> <refspec>
spool clone <url>
spool resume [<session-id>]
```

Spool is not limited to those commands. It exposes all common Git commands and options through the same entry point, for example:

```bash
spool status
spool diff
spool log
spool branch
spool merge
spool rebase
```

Commands unrelated to sessions retain Git's semantics, output, and exit codes.

Session-lifecycle commands retain Git-compatible arguments and code semantics, but may add documented Spool diagnostics and failure states.

Users should not need to switch between the `git` and `spool` CLIs during normal work.

`spool` is the command name. Names such as `origin` are remote names. A remote does not need to be named `spool`.

Spool reuses Git trees, commits, refs, diffs, merges, signatures, and transport. Session-aware commands add snapshot behavior.

Native `git` can still read and operate on these Git objects, but it understands only code and does not provide Spool's session guarantees.

## 2. Local Storage

Git maintains its object database (ODB), and Spool maintains a separate object store:

```text
$GIT_COMMON_DIR/
├── objects/                 Git object database (ODB)
│   ├── commit
│   ├── tree
│   └── blob
│
└── spool/
    ├── objects/             Spool object store
    │   ├── snapshot
    │   ├── sequence
    │   ├── occurrence
    │   └── provider record
    ├── index/               rebuildable query indexes
    └── identity/            local session identity mappings
```

Git and Spool objects are named by content hashes. Within one hash domain, only identical canonical bytes produce the same OID, avoiding duplicate storage or transfer.

By default, Spool objects live under `$GIT_COMMON_DIR/spool`. A normal clone, multiple worktrees for one repository, and a bare repository can therefore share one Spool object store.

In a linked worktree, `.git` may be only a file that points to the common directory.

Each worktree keeps its own scan cursor and temporary state. A session that moves across worktrees must not be split into multiple sessions.

## 3. How Commits Record Sessions

Spool adds several headers to a Git commit:

```text
tree <git-tree-oid>
parent <parent-commit-oid>
author ...
committer ...
spool-version 1
spool-coverage complete
spool-snapshot captured sha256:<snapshot-oid>

commit message
```

If one commit relates to multiple sessions, it contains multiple `spool-snapshot` headers:

```text
spool-snapshot captured sha256:<snapshot-a>
spool-snapshot captured sha256:<snapshot-b>
```

These headers are part of the commit content. Git computes the commit OID from the complete content, including these headers.

Changing a session association later therefore produces a different commit OID. A server or database cannot silently alter the relationship between a commit and its sessions.

Signatures must also cover these headers. Spool adds its headers first, then lets Git perform its existing GPG or SSH signing flow.

### 3.1 Why the Full Session Is Not Stored in the Commit

A complete session may be tens or hundreds of megabytes. Putting it directly in Git would make clones, fetches, GC, and the code repository much heavier.

The commit stores only a snapshot OID of a few dozen bytes. The actual content remains in the Spool object store and is downloaded on demand.

### 3.2 Why the References Cannot Point Both Ways

The relationship must be one-way:

```text
commit → session snapshot
```

The snapshot cannot point back to this commit OID. The snapshot OID must exist before the commit can include it; a reverse reference would create a hash cycle.

After the commit exists, Spool can build a reverse query index. That index exists only for fast lookup and can be rebuilt after deletion.

## 4. What Happens During Commit

When a user runs `spool commit`:

1. Spool reuses Git to prepare the tree, parents, author, message, and other existing content;
2. Spool reads newly added, complete local provider records;
3. Spool creates immutable snapshots for related sessions;
4. Spool writes objects to `$GIT_COMMON_DIR/spool/objects`;
5. Spool gives the snapshot OIDs to Git;
6. Git writes the `spool-*` headers;
7. Git signs the commit, computes its OID, and updates the branch ref.

The entire commit flow accesses only local files. A network outage must not prevent a commit.

If local Spool storage is damaged or a provider log cannot be parsed safely, the commit stops by default. Capture failure must never be silently presented as "no session."

The user can explicitly run `spool commit --no-session`. That commit contains:

```text
spool-version 1
spool-coverage omitted
```

`omitted` means the user deliberately skipped capture. It must not be interpreted as confirmation that no session existed.

### 4.1 Which Sessions Enter a Commit

Spool does not decide "who wrote this code." It records only sessions that are explicitly associated with the repository at commit time.

A session enters a commit automatically only if:

- it has been confirmed to belong to this repository;
- its repository/worktree context overlaps the current commit;
- it has produced at least one new, complete message or tool item since the previous checkpoint.

All sessions that meet these conditions are recorded. Spool does not select only the most recently active session.

A session captured by an earlier commit is not repeated automatically if it has produced no complete record since the previous checkpoint.

Otherwise, every later commit would carry an old session forever, and the header could no longer express which session work this commit captured. An explicit include or pin is the exception.

A session inferred only from temporal proximity, a branch name, or a path string does not enter a permanent header. It remains a candidate for confirmation.

Users can explicitly include or exclude a session. An explicit choice always overrides automatic selection.

The header means only "this session snapshot was captured at commit time." It does not claim that the session was the sole author.

## 5. Checkout Handles Only Code

`spool checkout` preserves Git checkout's code semantics:

```text
commit → tree → blobs → working tree
```

Checkout does not read or download session bodies, create a Session View, or start Claude, Codex, or another agent.

Resume is not part of the checkout flow. Only a later, explicit `spool resume` inspects the sessions associated with whatever `HEAD` is current at that time.

Resume does not run checkout, change `HEAD` or the index, modify code files, or create a Git worktree.

Native Git does not understand `spool-*` headers and simply ignores them. Code checkout remains unaffected.

## 6. Push, Fetch, and Clone

### 6.1 Remotes Differ Only by Capability, Not by Reserved Names

Spool works with two kinds of targets:

```text
Git-only remote         → Git commits, trees, blobs, refs
Session-capable remote  → the Git data above + Spool session objects
```

A remote may be named `origin`, `github`, or anything the user chooses. Spool detects capability through protocol negotiation and must not infer it from the name.

Commit headers contain only location-independent snapshot OIDs, never remote names or URLs.

Spool treats a target as Git-only only after a successful negotiation explicitly reports no Spool capability. If negotiation itself fails, the command fails rather than silently degrading to code-only.

### 6.2 `spool push`

Users always run:

```bash
spool push <remote> <refspec>
```

For a Git-only remote, Spool reuses standard Git transport, uploads only Git objects, and clearly reports that session bodies were not published.

Once negotiation explicitly identifies the target as Git-only, the operation proceeds without requiring an additional `--code-only` option.

For a session-capable remote:

1. the Rust push engine finds snapshots referenced by the new commits;
2. the client first uploads Spool objects missing from the server;
3. Git transport uploads commits, trees, and blobs;
4. the server verifies the complete snapshot closure of every `spool-snapshot`;
5. only after verification does the server update the branch ref.

The branch ref is the final publication switch. A successful ref update means both the commit and all referenced session objects exist completely.

The server rejects a ref update if any Spool object is missing. Temporary objects uploaded but not referenced by a ref are removed later according to a TTL.

If a user bypasses Spool and runs native `git push`, a Git-only remote may still accept the code. A session-capable remote must use server-side closure validation to reject incomplete updates.

### 6.3 GitHub Example

If `origin` points to GitHub:

```bash
spool push origin main
```

Negotiation tells Spool that GitHub is Git-only, so Spool uploads only Git objects:

```text
GitHub
├── commits (including spool-* pointer headers)
├── trees
├── blobs
├── branches
└── tags
```

GitHub does not receive `$GIT_COMMON_DIR/spool/objects`. It therefore has the complete code history and snapshot pointers, but no session bodies:

```text
GitHub commit ──> Snapshot OID ──> body unavailable
```

GitHub must preserve the `spool-*` headers exactly because removing one changes the commit OID.

Custom headers may not appear in GitHub's UI or structured APIs. Real GitHub push compatibility tests must cover this behavior.

### 6.4 `spool clone` and `spool fetch`

Users use the same commands for either kind of address:

```bash
spool clone <url>
spool fetch <remote>
```

Cloning or fetching from a Git-only address such as GitHub retrieves only Git data. Spool preserves snapshot OIDs in commits but does not search other services or download session bodies:

```text
Session snapshot: sha256:<snapshot-oid>
Status: body unavailable
```

From a session-capable address, Spool retrieves Git data and registers the same address as a source for session objects. The first clone does not download historical sessions; only explicit resume downloads the selected snapshot on demand.

Regardless of source type, clone, fetch, and checkout do not generate a Session View or start Claude, Codex, or another agent.

Fetch only updates refs; a session-capable clone or fetch only registers the session object source. Only explicit `spool resume` reads the current `HEAD` sessions.

### 6.5 Optional Dual-Remote Configuration

A repository may configure two remotes with arbitrary names, for example:

```text
github  → Git-only remote
origin  → Session-capable remote
```

The corresponding commands are:

```bash
spool push github main  # code; session pointers remain, but bodies are not published
spool push origin main  # code + session objects
```

The two pushes are independent. Spool does not implement a distributed transaction across remotes or automatic discovery from GitHub to a session service.

The selected target defines the capability boundary for that publication.

## 7. Incremental Session Storage

The same session grows over time:

```text
Commit A → Snapshot S1 → messages 1–10
Commit B → Snapshot S2 → messages 1–15
Commit C → Snapshot S3 → messages 1–20
```

Spool does not store three complete copies of the session.

It stores message order in a Merkle sequence whose nodes can be shared:

```text
S1 → [1 ... 10]
S2 → [1 ... 10] + [11 ... 15]
S3 → [1 ... 15] + [16 ... 20]
```

The common portions of S1, S2, and S3 are stored once. Each commit normally adds only records created since the previous commit and a small number of sequence nodes.

A snapshot points directly to its complete current sequence root. Reading S3 does not require reading and accumulating S1 and then S2.

### 7.1 Provider Log Compaction or Rewrite

Claude or Codex may compact, truncate, or rewrite a session tail.

Spool compares the common prefix of the old and new sequences and creates a new root:

```text
old snapshot → [a, b, c, d]
new snapshot → [a, b, x]
```

`a, b` can be reused. The old `c, d` do not incorrectly appear in the new snapshot.

A snapshot does not express current state as "parent + appended list," so it needs neither removal instructions nor periodic full keyframes.

### 7.2 Repeated Identical Content

The same phrase, such as "continue," may appear several times in one session.

Spool may reuse the same body, but the sequence preserves every occurrence position. Equal content hashes must not remove repeated messages from the timeline.

## 8. Raw Records and Readable Content

By default, a Spool-enabled repository stores complete sessions. "Complete" means messages, tool calls, tool results, and required metadata written by Claude or Codex and capturable by the adapter.

The MVP has only this resumable storage mode. Users must explicitly enable it with `spool init`; repositories that are not Spool-enabled do not capture sessions.

Complete sessions use raw provider records from Claude or Codex as the body source.

Spool also stores small descriptors such as the role, item type, and position within a record. Search text can be regenerated and is not stored by default as a second complete body.

This avoids storing both raw JSONL and a nearly identical canonical session.

A version containing only user prompts or readable text cannot resume reliably, so it is not an MVP storage mode.

It may later become an export or sharing format explicitly marked "not resumable." It must not be confused with a complete snapshot.

### 8.1 Resume a Session from the Current Commit

The command has two forms:

```bash
spool resume
spool resume <session-id>
```

There is one resolution rule:

```text
current HEAD
+ optional Spool session ID
→ exactly one snapshot
→ read source provider
→ materialize
→ provider-native resume
```

Every snapshot descriptor stores a stable Spool session ID and source provider. One session may have different snapshot OIDs across commits while retaining one Spool session ID. The same session ID may appear at most once in one commit.

Without `<session-id>`, Spool reads every snapshot pointer on the current `HEAD`:

1. zero matches: report an error and do not start an agent;
2. one match: call that agent's resume directly without asking again;
3. multiple matches: show session IDs and providers in an interactive chooser;
4. multiple matches in a non-interactive environment: list the session IDs, report an error, and require an explicit retry.

With `<session-id>`, Spool searches only the current `HEAD` candidates. It does not search other commits. A missing ID is an explicit error.

After selecting a snapshot, Spool materializes it exactly as a provider-native local session with a new provider session ID, then invokes the provider's native resume:

```text
Codex snapshot  → codex resume <new-session-id>
Claude snapshot → claude --resume <new-session-id>
```

Codex provides both `resume` and `fork`.

The official CLI documentation defines [`codex resume`](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-resume) as opening and continuing an existing interactive session by ID.

[`codex fork`](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-fork) creates another task from an existing Codex session.

Spool already created the copy during materialization, so it calls `resume` on the new ID and does not call `fork`.

Spool selects the adapter from the snapshot's source provider: a Claude snapshot invokes Claude, and a Codex snapshot invokes Codex. The user cannot override the provider; an unknown provider is an explicit error.

Resume does not run checkout, change `HEAD` or the index, modify code files, or create a Git worktree. It does not append records added to the original session after the selected snapshot.

Spool passes no initial prompt, initiates no model turn, and approves no tool call. Provider startup initialization is outside this guarantee. The agent opens waiting for user input.

The adapter must pass a real CLI round-trip test. If materialization fails, it must report "resume unsupported" rather than opening an empty session or sending a concatenated prompt.

The original snapshot and provider session remain unchanged.

## 9. Session Identity

Spool stores a stable Spool session ID for every source session. It is the CLI selector, not a snapshot OID or the new provider-native session ID created during resume.

When a provider exposes a stable session ID, Spool derives a stable identifier without revealing the original value. Otherwise, it generates a random ID when it first sees the session and stores it in the local identity registry.

The same session can produce a new snapshot OID at every commit while retaining one Spool session ID. Therefore `(HEAD, session-id)` resolves to at most one snapshot; duplicates mean the commit data is malformed.

If the identity registry is lost or two sessions cannot be proven identical, Spool creates a new ID and keeps them separate. It does not alias or merge them automatically.

## 10. Rust-First Implementation

Spool is one repository. It directly tracks a version-pinned copy of upstream Git plus the small Spool patches under `packages/git/`; `packages/git/` is not a submodule.

It does not depend on whichever Git version happens to be installed on the user's machine, and hooks are not a correctness boundary.

Both `packages/git/` and `packages/spool/` are packages in the monorepo. Only Rust directories are Cargo workspace members.

The root `Cargo.toml` explicitly lists `packages/spool/`; it does not include `packages/git/`. Ordinary Git-compatible commands go to the Git engine, while session capabilities enter the Rust package.

```text
spool/
├── Cargo.toml                # Cargo member: packages/spool
└── packages/
    ├── git/                  # pinned upstream Git source + Spool patches
    │   └── status, diff, commit, merge, rebase, transport...
    └── spool/                # Rust sessions, storage, adapters, CLI, helper
```

Git remains responsible for trees, parents, the message editor, hooks, signing, commit objects, reflogs, refs, and pack transport.

Rust handles sessions, objects, hashes, sequences, provider parsing, resume, and upload.

The real boundary is a small Git-engine/helper interface, not Git's current directory structure. The engine passes prepared operation context to Rust and receives headers or results.

The Rust package must not depend on files or internal types under `packages/git/`. This keeps that package replaceable: Spool can gradually substitute a Git-compatible engine written in Rust without redesigning session storage or the CLI.

### 10.1 How Much Git Must Change

Git already supports extra commit headers. `spool commit` does not need to reimplement the complete Git commit flow.

Session-aware commit, amend, and sequencer paths add only these steps:

1. prepare a small amount of information, including the tree, parents, operation kind, and source commit;
2. call the Rust `spool-git-helper`;
3. pass the returned headers to Git's existing commit builder;
4. let Git sign and write the commit through its normal flow.

The low-level `commit_tree_extended(...)` function does not scan sessions. It only writes headers already prepared by its caller.

Repositories that are not Spool-enabled, server-side Git, and ordinary plumbing commands retain their existing behavior.

New `spool push` logic should live in Rust wherever possible. Rust handles capability negotiation and Spool object upload, Git transport handles Git objects, and the server performs final validation.

The MVP starts with an external Rust helper. A hook cannot replace this bridge. Spool should consider a persistent daemon only if benchmarks show process startup affects commit latency.

## 11. Amend, Rebase, and Merge

| Git operation                  | Spool behavior                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Normal commit                  | Capture the currently and explicitly associated sessions                                                         |
| Merge commit                   | Capture only sessions related to the merge, review, or conflict resolution                                       |
| Fast-forward                   | No new commit, so no new snapshot pointer                                                                        |
| Amend                          | Capture again, replace old Spool headers, and produce a new commit OID                                           |
| Rebase with no content changes | Preserve the original snapshot pointer and mark it `carried`                                                     |
| Rebase edit/conflict           | Mark the original snapshot `carried`; mark the conflict-resolution session `captured`                            |
| Cherry-pick                    | Capture the current operation session by default; keep the original session only as a candidate for confirmation |
| Squash                         | Deduplicate and mark all source snapshots `carried`; mark the squash session `captured`                          |

Whenever the rebase sequencer knows the old-to-new commit mapping, Spool copies the old commit's snapshot pointers and changes their relation from `captured` to `carried`:

```text
spool-snapshot carried sha256:<snapshot-oid>
```

This does not copy the session body. It preserves the same immutable snapshot OID in the new commit.

`carried` asserts only that the session came from a transformed source commit. It does not claim that the session fully explains the resulting code.

A mechanical rebase with no new session produces a commit containing only `carried` pointers.

During an edit or conflict, old pointers remain `carried`, while sessions created during resolution are added as `captured`. Both relations may appear together.

A squash is an explicit many-to-one history transformation and follows the same rule.

The result commit carries every source commit's snapshot OIDs, with duplicate OIDs written once. Sessions created during squash, edit, or conflict are added as `captured`.

A new commit created by vanilla Git may not preserve Spool headers. Spool marks it `unknown` and asks the user to inspect or amend it.

## 12. Migrating Existing Repositories

Existing commits have no Spool headers. Adding a header changes a commit OID and recursively changes all descendant commit OIDs.

The MVP provides one migration mode:

```bash
spool import
```

It scans local sessions, proposes relationships between old commits and snapshots, and previews the branches, commits, and session pointers that it will rewrite.

Only confirmed relationships may enter a commit. An uncertain candidate must not be presented as fact. After confirmation, Spool rebuilds the reachable history and writes `spool-snapshot` headers into the commits.

Git commits are immutable. "Modifying an old commit" therefore means creating a new commit with the same code content plus different headers, then moving local branch refs to the new history.

Every rewritten commit and every descendant receives a new OID. Spool must show this consequence before proceeding and update local refs only after the entire rewrite succeeds.

Collaborators must migrate to the new history together. `spool import` does not push automatically. By default, the rewritten history may be pushed only to a new empty remote; Spool never force-pushes an existing remote automatically.

`spool import` is only for enabling Spool for the first time in an existing repository. A new Spool-enabled repository uses `spool commit` normally and does not need import.

## 13. Permissions, Deletion, and Corruption

Spool object OIDs always use ordinary SHA-256. Tenant and repository isolation belongs in storage namespaces and authorization, and moving between tenants must not change a pointer in a commit.

By default, private repositories do not make global object-existence queries or deduplicate across tenants.

Commits are immutable, so an existing snapshot pointer cannot be removed in place.

If a session contains a secret or must be removed for legal reasons, Spool can revoke access and delete the body. The commit retains the original snapshot OID, but reads return `withdrawn`.

The server must immediately deny future access to a `withdrawn` session. Copies already downloaded locally or saved offline cannot be revoked retroactively.

The time needed to purge objects physically from primary storage, backups, and replicas is a deployment-specific operational and compliance policy. It is not encoded in the object format or a blocker for local storage architecture.

A damaged object must not be replaced with different content under the original OID. The same OID can be restored only with exactly the same bytes.

## 14. Why This Is Worth Doing

Local samples show little direct deduplication across different sessions. The major repetition comes from repeatedly storing the full prefix of one growing session across multiple commits.

Spool's sequence sharing addresses exactly that repetition.

Git pack and zstd can also compress repeated prefixes. Before freezing the storage format, Spool must benchmark real commits and compressed disk and network sizes.

Uncompressed experimental savings must not be presented as final product savings.

## 15. MVP Sequence

### Slice 0: Validate the Format First

- verify that custom headers pass Git fsck;
- verify compatibility with GitHub, GitLab, JGit, and libgit2;
- verify that GPG/SSH signatures cover the headers;
- verify amend, rebase, bundles, and SHA-256 repositories;
- benchmark real commits with pack/zstd.

### Slice 1: Local Rust Object Store

- Claude/Codex adapters;
- Spool object store;
- session identity;
- Merkle sequence;
- checkpoint and byte-exact reconstruction;
- truncate/rewrite and repeated-message tests.

### Slice 2: `spool commit` Integration

- Rust helper;
- `spool-*` commit headers;
- commit, merge, and amend;
- rebase/cherry-pick operation context;
- `spool commit --no-session` and failure handling.

### Slice 3: Spool Push and Migration

- Rust push engine and remote capability negotiation;
- server-side object validation;
- session-capable server protocol;
- history rewrite, preview, and local ref update for `spool import`.

### Slice 4: Spool Product Integration

- show related sessions on commit pages;
- show related commits on session pages;
- do not generate a Session View or start an agent after checkout or clone;
- select a current `HEAD` session during resume: open one directly, show a chooser for multiple sessions, and require `<session-id>` when non-interactive;
- let the snapshot determine the provider, materialize a new provider-native local session exactly, and open it with native resume without modifying the snapshot;
- do not send an initial prompt, initiate a model turn, or approve a tool call during resume; provider startup initialization is outside this guarantee; stop at an interface waiting for user input;
- expose carried, omitted, and withdrawn states;
- support on-demand download and permission checks.

## 16. MVP Acceptance Criteria

- The commit OID and signature cover the `spool-*` headers;
- ordinary Git can clone, checkout, log, fsck, and push these commits;
- users access related behavior through the unified `spool commit`, `spool checkout`, `spool push`, `spool clone`, and `spool resume` commands;
- Git-compatible commands unrelated to sessions retain Git's arguments, output, exit codes, and behavior; session-aware commands retain Git-compatible arguments and code semantics but may add documented Spool diagnostics and failure states;
- Spool directly tracks a bundled, version-pinned Git engine under `packages/git/`, not as a submodule;
- `packages/git/` and `packages/spool/` are monorepo packages, but only `packages/spool/` is a Cargo workspace member;
- the Rust package depends only on the narrow engine/helper interface, and correctness does not depend on hooks;
- new Git logic only calls the Rust helper and passes headers;
- commit never accesses the network;
- capture failure never silently becomes zero sessions;
- one commit can relate to zero, one, or multiple sessions;
- an old session with no new complete record does not enter later commits automatically unless explicitly included or pinned;
- when rebase knows the source-to-result mapping, it preserves source snapshot OIDs as `carried`; edit/conflict also captures resolution sessions;
- squash automatically carries all deduplicated source snapshot OIDs and separately captures new squash sessions;
- the same session across commits adds only missing objects;
- repeated messages do not disappear from the session timeline;
- provider truncate/rewrite does not restore content removed by the provider;
- reading a snapshot does not require traversing every older snapshot;
- a complete, resumable snapshot does not store two complete session bodies by default;
- after `spool init`, Spool stores complete sessions by default; exports containing only prompts or readable text are explicitly marked not resumable;
- a session-capable remote ref cannot update during push if the snapshot closure is incomplete;
- after `spool push` explicitly identifies a Git-only remote, it automatically performs a code-only push and reports that session bodies were not published;
- ordinary Git remotes continue to work;
- `spool import` writes only confirmed session relationships into new commits and previews OID changes before updating local refs.
- checkout and clone never start an agent automatically under any circumstances.
- `spool resume` reads only the current `HEAD`: zero sessions report an error, one opens directly, and multiple show an interactive chooser.
- multiple sessions in a non-interactive environment require `<session-id>`; an explicit ID must belong to the current `HEAD`.
- Spool reads the source provider from the snapshot and selects the matching adapter automatically; users cannot override it, and cross-provider resume does not occur.
- the Codex adapter uses `codex resume <new-session-id>`; the Claude adapter uses `claude --resume <new-session-id>`; neither passes a prompt.
- resume restores records only through the selected snapshot's boundary and never carries the original session's later tail automatically.

## 17. Remaining Engineering Validation, Not Product Decisions

Core product and architecture semantics are settled. The following items are resolved through prototypes, benchmarks, and deployment configuration, not further product decisions:

1. The initial incremental-checkpoint performance target is p95 at most 100 ms and p99 at most 250 ms; the first full import must not enter the commit hot path;
2. real CLI round-trips from a Claude/Codex snapshot to a new provider-native session and then native resume;
3. compatibility tests for GitHub, GitLab, JGit, libgit2, signatures, and SHA-1/SHA-256 repositories;
4. actual disk and network savings after pack/zstd;
5. closure validation by a session-capable server during interrupted uploads, missing objects, and failed ref updates;
6. the deployment configures the physical-deletion and backup-purge SLA for `withdrawn` according to compliance requirements.
