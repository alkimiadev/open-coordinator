<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/banner-dark.svg" />
  <img alt="Open Coordinator warm paper banner" src="docs/assets/brand/banner-light.svg" width="100%" />
</picture>

# Open Coordinator

> **Fork of [open-trees](https://github.com/0xSero/open-trees)** by [0xSero](https://github.com/0xSero)
>
> This is a fork maintained by [Alkimia Development](https://github.com/alkimiadev) with enhancements for coordinated development workflows.

OpenCode plugin for fast, safe `git worktree` workflows with enhanced session management and real-time monitoring.

## Features

- **Single tool, registry pattern** — One `worktree` tool with `{action, args}` dispatch (like `@alkdev/open-memory`)
- **Automatic role detection** — Coordinator vs. implementation roles inferred from session state
- **No mode toggle** — Removed the old `worktree_mode` gate; all operations work immediately
- **Fresh sessions** — Clean context using `session.create()` instead of `session.fork()`
- **Bidirectional communication** — Coordinator ↔ spawned sessions messaging
- **Real-time monitoring** — SSE-based anomaly detection with automatic notifications

## Install

Single command (recommended):

```bash
bunx open-coordinator add
```

This updates your OpenCode config (default: `~/.config/opencode/opencode.json`).
OpenCode installs npm plugins automatically at startup (cached in `~/.cache/opencode/node_modules`).

Manual config:

```json
{
  "plugin": ["@alkimiadev/open-coordinator"]
}
```

For local development, build the plugin and point OpenCode at the local package:

```bash
bun install
bun run build
```

```json
{
  "plugin": ["/absolute/path/to/open-coordinator"]
}
```

## The `worktree` Tool

The plugin exposes a single `worktree` tool. Call it with `{action: "<operation>", args: {...}}`:

```text
worktree({action: "help"})                           → Show all available operations
worktree({action: "help", args: {action: "spawn"}})  → Details for the spawn operation
```

### Role-Based Access

Operations available depend on your session's role:

**Coordinator** (default — sessions not spawned by another session):

```text
worktree({action: "list"})                           → List git worktrees
worktree({action: "status"})                         → Show worktree git status
worktree({action: "dashboard"})                      → Worktree dashboard with session info
worktree({action: "create", args: {name: "feat"}})   → Create a new worktree
worktree({action: "start", args: {name: "feat"}})    → Create worktree + start fresh session
worktree({action: "open", args: {pathOrBranch: "feat"}}) → Open existing worktree in session
worktree({action: "fork", args: {name: "feat"}})     → Create worktree + fork current context
worktree({action: "swarm", args: {tasks: ["a","b"]}}) → Parallel worktrees + sessions
worktree({action: "spawn", args: {tasks: ["a","b"], prompt: "Task: {{task}}"}})
                                                     → Spawn with async prompts
worktree({action: "message", args: {sessionID: "ses_...", message: "..."}}) → Message session
worktree({action: "sessions"})                       → Query spawned session status
worktree({action: "abort", args: {sessionID: "ses_..."}}) → Abort a session
worktree({action: "cleanup", args: {action: "prune", dryRun: true}}) → Prune worktrees
worktree({action: "cleanup", args: {action: "remove", pathOrBranch: "feat"}}) → Remove worktree
```

**Implementation** (sessions spawned by a coordinator — limited to prevent recursive worktree creation):

```text
worktree({action: "current"})                        → Show your worktree mapping
worktree({action: "notify", args: {message: "Done!", level: "info"}}) → Report to coordinator
worktree({action: "status"})                         → Show worktree git status
worktree({action: "help"})                            → Show available operations
```

### Implementation Agent Workflow

```text
# Commands run automatically in worktree — no workdir needed
worktree({action: "notify", args: {message: "Tests passing, starting implementation"}})
worktree({action: "notify", args: {message: "Blocked: missing dependency", level: "blocking"}})
worktree({action: "notify", args: {message: "Task completed", level: "info"}})
```

### Coordinator Workflow

```text
# 1. Spawn parallel tasks
worktree({action: "spawn", args: {
  tasks: ["auth-setup", "db-schema", "api-routes"],
  prefix: "feat/",
  agent: "implementation-specialist",
  prompt: "Your task: {{task}}. Read tasks/{{task}}.md for details."
}})

# 2. Monitor progress
worktree({action: "sessions"})

# 3a. Recovery message if degraded
worktree({action: "message", args: {sessionID: "ses_abc...", message: "Please retry"}})

# 3b. Abort if unrecoverable
worktree({action: "abort", args: {sessionID: "ses_abc..."}})

# 4. Cleanup when done
worktree({action: "cleanup", args: {action: "remove", pathOrBranch: "feat/auth-setup"}})
```

## Plugin Hooks

The plugin automatically injects context for mapped sessions:

### `tool.execute.before`

Automatically injects `workdir` for bash commands when the session is mapped to a worktree:

```text
bash({ "command": "npm test" })  → Automatically runs in worktree
```

### `shell.env`

Injects environment variables for all shell commands:

- `OPENCODE_WORKTREE_PATH` — Full path to worktree
- `OPENCODE_WORKTREE_BRANCH` — Branch name

### `experimental.session.compacting`

Custom compaction prompt that instructs the agent to summarize for itself (not another agent).

## Real-Time Monitoring

SSE-based anomaly detection monitors spawned sessions:

| Heuristic | Condition | Severity | Action |
|-----------|-----------|----------|--------|
| **Model Degradation** | Malformed tool calls (`tool === "tool"`) | High | Likely broken model, consider abort |
| **High Error Count** | >5 tool errors in session | Medium | Check session, may need guidance |
| **Session Stall** | No activity for 60s while busy | Medium | Send "please continue" message |

Notifications use `worktree` tool syntax:

```
⚠️ ANOMALY DETECTED [feat/auth-setup]

Session: ses_abc123
Branch: feat/auth-setup
Issue: MODEL_DEGRADATION (high severity)

Run: worktree({action: "abort", args: {sessionID: "ses_abc123"}})
```

## Context Awareness (with @alkdev/open-memory)

For best results, use alongside `@alkdev/open-memory` which provides:
- Real-time context window awareness
- Session history and search
- Manual compaction control

```json
{
  "plugin": ["@alkimiadev/open-coordinator", "@alkdev/open-memory"]
}
```

## Defaults and Safety

- Default worktree path (when `path` is omitted): `<repo>/.worktrees/<branch>`
- Relative `path` inputs are resolved under `.worktrees/` to prevent traversal
- Branch name is derived from `name` when `branch` is omitted (lowercased, spaces to `-`)
- Cleanup refuses to delete dirty worktrees unless `force: true`
- Implementation agents cannot create, spawn, swarm, abort, or cleanup — only report and query

## Development

```bash
bun run lint
bun run typecheck
bun run build
bun run test
```

For local testing, symlink your repo to OpenCode's plugin cache:

```bash
rm -rf ~/.cache/opencode/node_modules/@alkimiadev/open-coordinator
ln -s /path/to/open-coordinator ~/.cache/opencode/node_modules/@alkimiadev/open-coordinator
```

After rebuilding (`bun run build`), restart OpenCode to pick up changes.

## Versioning

Open Coordinator follows Semantic Versioning and tracks notable changes in `CHANGELOG.md`.

## Brand

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/release-dark.svg" />
  <img alt="Open Coordinator release card" src="docs/assets/brand/release-light.svg" width="100%" />
</picture>

Brand visuals, SVG assets, and usage guidelines live in `docs/brand.md`.

## Contributing

See `CONTRIBUTING.md` for setup, testing, and release guidelines.