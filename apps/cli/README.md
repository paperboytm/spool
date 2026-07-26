# @spool-lab/cli

CLI for publishing, reading, resuming, and managing agent Sessions with [Spool](https://spool.new).

## Install

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Install once, open a new terminal, then verify the command with `spool --version`. After that, use `spool` from any project.

## Everyday Commands

The everyday surface is deliberately small. Configure trust once, keep the daemon running, and handle exceptions explicitly:

```bash
spool login                      # one-time hub credential
spool subscribe [dir]            # one-time disclosure decision per project
spool daemon start               # continuous publishing survives reboots
spool                            # in a subscribed dir: catch-up pass; elsewhere: share latest
spool share <session-uuid>       # explicit one-off share
spool visibility <sid|url> <target>  # change a published Session's disclosure
spool withdraw <session-id-or-url>
spool resume <session-id-or-url>
spool doctor                     # health: index, daemon, credentials, environment
spool logout
```

## Continuous Publishing

```bash
spool subscribe [dir] --team <handle|name|id> # Team · {name}: current members only
spool subscribe [dir] --link-only           # anyone with the URL
spool subscribe [dir] --public              # explicit opt-in to Explore/search
spool unsubscribe [dir]
spool subscriptions
spool teams                                 # list the Teams you belong to
spool projects list                         # list writable personal and Team Projects
spool projects bind [dir] --project <id|owner/slug>
spool projects move <sid|url> --project <id|owner/slug>
spool daemon start|stop|status|logs|run
```

`--team` accepts a stable Team handle, an id, or a unique Team name. When names collide, Spool fails closed and asks for a handle or id.

Subscribing a directory is the one-time disclosure and Project decision: from then on, the daemon publishes new and updated Sessions recorded in that directory — including its git worktrees and worktrees managed by tools like superset or orca — without prompting. The disclosure target is always an explicit choice among `Team · {name}`, Link-only, and Public; **there is no implicit default and Public is never preselected**. Every hosted Session also belongs to one personal or Team Project. Interactive `spool subscribe` offers a Project or can create one. Automation must pass `--project <id|owner/slug>` or `--create-project <name>` unless an account-, tenant-, Hub-, and local-Project-specific binding already exists; `--yes` never chooses a Project.

`spool daemon start` registers the watcher with launchd (macOS) or a systemd user unit (Linux) so it runs at login and restarts on failure. `spool daemon run` is the same loop in the foreground.

Sessions with likely sensitive values are never auto-published: they are skipped with a warning and left for an explicit `spool share`.

## Share and Continue

```bash
spool
spool share <session-uuid>
spool resume <session-id-or-url>
spool withdraw <session-id-or-url>
```

Bare `spool` adapts to context: in a subscribed directory it refreshes the index and runs one catch-up publish pass; elsewhere it refreshes the index, signs in if needed, and shares the latest Session in the current project. `spool share` is the explicit form for selecting a Session or passing options. Both flows check records for likely sensitive values, confirm the resulting visibility, create a durable URL, and can ask a detected local Agent to draft the optional Summary. Claude Code and Codex CLI Sessions are Public in Explore by default; providers not yet supported by Explore remain Link-only. Non-interactive callers must pass `--visibility-confirmed`; this does not bypass sensitive-data findings.

Useful publishing options:

```bash
spool share <uuid>@12              # first 12 records
spool share --no-agent-summary     # skip local Agent generation
spool share --spool-file x.spool   # attach a curated document
spool share --project evan/spool   # bind this local Project to an existing Hub Project
spool share --create-project Spool # create and bind a Project
spool share --team paperboy --project paperboy/react-vapor # Team-only from the first upload
spool share --visibility-confirmed # acknowledge visibility without a TTY
spool share --yes                  # skip all confirmations, including secret findings
```

For the normal interactive flow, omit Summary options. Spool resolves the exact local Project joined to the selected Session—even when the command is run from another directory—and asks for a Hub Project the first time. Re-sharing keeps the Session's existing remote Project. After the Session URL is live, Spool can ask a detected local Agent to draft the optional Summary. `--summary <markdown>` is an advanced manual or automation input: it uploads exactly the Markdown supplied by the caller and does not generate a Summary.

`--team <handle|name|id>` is the direct one-off Team path. It requires a Team-owned Project (explicitly or through an existing Team binding), names the Team and ownership transfer in the confirmation, shows the selected Project before upload, and writes `Team · {name}` on the first Hub head—there is no intermediate Public Session.

Move an already-hosted Session between Projects owned by the same user or Team with `spool projects move <sid|url> --project <id|owner/slug>`. The command sends the current Project as an optimistic precondition and never changes records, visibility, authorship, stars, or verified-fork lineage. Use `spool visibility … team` instead when the tenant itself must change.

For Claude Code and Codex CLI shares, Resume verifies the shared records, writes a new provider-native Session, preserves the source relationship, and launches the agent. Use `--workspace <dir>` to choose the project or `--no-exec` to prepare without launching.

## Change Disclosure Later

```bash
spool visibility <sid|url> public            # Team → Public keeps Team ownership
spool visibility <sid|url> link-only
spool visibility <sid|url> team --team <handle|name|id> --project <id|owner/slug>
spool visibility <sid|url> team --team <handle|name|id> --create-project <name>
```

Disclosure changes are named, confirmed actions and never re-upload records. Changing a Team-owned Session requires a Team Owner or Admin role; moving a personal Session into a Team transfers ownership to the Team. The same control exists on spool.new under your account's Sessions list.

## Browse Local Sessions

```bash
spool sessions list [-s <source>] [-p <path>] [-n <count>] [-a|--all] [--json]
spool sessions search <query> [-s <source>] [--since 7d] [-n 10] [--json]
spool sessions show <uuid>                 # local conversation
spool sessions show <session-id-or-url>    # Shared Session overview
spool sessions show <session> --log        # record timeline
spool sessions show <session> --diff       # composed net diff
spool sessions show <session>@r3           # specific record
```

Local indexing supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi. Browsing never publishes anything; only subscriptions and explicit shares do.

## Diagnostics

```bash
spool doctor
spool doctor <check-id>
spool doctor --json
spool doctor --fix
spool doctor --fix --force
```

`spool doctor` includes the daemon heartbeat and local index status (previously `spool status`).

## Local Data

The CLI uses `~/.spool/` by default:

- `spool.db` — local Session metadata, messages, search, and state
- `hub-credentials.json` — revocable Hub credential from `spool login`
- `subscriptions.json` — directories subscribed for continuous publishing
- `project-bindings.json` — `0600` local-to-Hub Project bindings scoped by Hub, account, and tenant
- `auto-publish-state.json` — per-Session fingerprints that keep auto-publish incremental
- `daemon.json` / `daemon.log` — daemon heartbeat and log

Set `SPOOL_DATA_DIR` to isolate a different data directory.

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.
