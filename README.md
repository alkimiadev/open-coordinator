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

- **Automatic workdir injection** - Plugin hooks inject workdir for mapped sessions
- **Fresh sessions** - Clean context using `session.create()` instead of `session.fork()`
- **Bidirectional communication** - Coordinator ↔ spawned sessions messaging
- **Real-time monitoring** - SSE-based anomaly detection with automatic notifications
- **Session state tracking** - Track spawned sessions with parent/child relationships

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

## Worktree mode

Worktree tools are gated behind worktree mode so they do not clutter the default tool list.
Enable it when you want to work with worktrees, then disable it when you are done.

```text
worktree_mode { "action": "on" }
worktree_mode { "action": "off" }
```

`worktree_mode` also prints a help sheet (tools + examples) so the model has the usage context.

Slash-native toggle (see `.opencode/command/worktree.md`):

```text
/worktree on
/worktree off
```

`/worktree on` enables the tools and emits the help sheet into the session.
`/worktree off` disables them and keeps them off for the next session.

## Tools

### Core Worktree Tools

- `worktree_mode` — enable/disable worktree mode and show help.
- `worktree_overview` — list, status, or dashboard worktrees.
- `worktree_make` — create/open/fork worktrees and sessions.
- `worktree_cleanup` — remove or prune worktrees safely.

### Session Management Tools

- `worktree_status` — query status of spawned sessions.
- `worktree_message` — send messages to spawned sessions for recovery or check-ins.
- `worktree_notify` — send messages back to coordinator session (completion, blocking issues).
- `worktree_abort` — abort stuck or degraded sessions.
- `worktree_current` — query worktree mapping for current session.

### Examples

Enable worktree mode:

```text
worktree_mode { "action": "on" }
```

List worktrees:

```text
worktree_overview
```

Status for all worktrees:

```text
worktree_overview { "view": "status" }
```

Show the worktree/session dashboard:

```text
worktree_overview { "view": "dashboard" }
```

Create a worktree (branch derived from name):

```text
worktree_make { "action": "create", "name": "feature audit" }
```

Start a new session (creates or reuses a worktree):

```text
worktree_make { "action": "start", "name": "feature audit", "openSessions": true }
```

Open a session in an existing worktree:

```text
worktree_make { "action": "open", "pathOrBranch": "feature/audit", "openSessions": true }
```

Fork the current session into a worktree:

```text
worktree_make { "action": "fork", "name": "feature audit", "openSessions": true }
```

Create a swarm of worktrees/sessions:

```text
worktree_make { "action": "swarm", "tasks": ["refactor-auth", "docs-refresh"], "openSessions": true }
```

Query spawned session status:

```text
worktree_status
```

Send message to spawned session:

```text
worktree_message { "sessionID": "ses_abc123", "message": "Please continue from where you left off" }
```

Notify coordinator of completion:

```text
worktree_notify { "message": "Task completed successfully", "level": "info" }
```

Notify coordinator of blocking issue:

```text
worktree_notify { "message": "Cannot proceed without dependency", "level": "blocking" }
```

Abort a stuck session:

```text
worktree_abort { "sessionID": "ses_abc123" }
```

Query current session mapping:

```text
worktree_current
```

Remove a worktree:

```text
worktree_cleanup { "action": "remove", "pathOrBranch": "feature/audit" }
```

Prune stale worktree entries:

```text
worktree_cleanup { "action": "prune", "dryRun": true }
```

## Plugin Hooks

The plugin automatically injects context for mapped sessions:

### `tool.execute.before`

Automatically injects `workdir` for bash commands when the session is mapped to a worktree:

```typescript
// Agent doesn't need to specify workdir
bash({ "command": "npm test" })  // Automatically runs in worktree
```

### `shell.env`

Injects environment variables for all shell commands:

- `OPENCODE_WORKTREE_PATH` - Full path to worktree
- `OPENCODE_WORKTREE_BRANCH` - Branch name

```bash
echo $OPENCODE_WORKTREE_PATH
echo $OPENCODE_WORKTREE_BRANCH
```

### `experimental.session.compacting`

Custom compaction prompt that instructs the agent to summarize for itself (not another agent).

## Real-Time Monitoring

The plugin includes SSE-based anomaly detection that monitors spawned sessions:

### Detection Heuristics

| Heuristic | Condition | Severity | Action |
|-----------|-----------|----------|--------|
| **Model Degradation** | Malformed tool calls (`tool === "tool"`) | High | Likely broken model, consider abort |
| **High Error Count** | >5 tool errors in session | Medium | Check session, may need guidance |
| **Session Stall** | No activity for 60s while busy | Medium | Send "please continue" message |

### Notifications

The coordinator automatically receives formatted notifications with actionable suggestions:

```
⚠️ ANOMALY DETECTED [feat/auth-setup]

Session: ses_abc123
Branch: feat/auth-setup
Issue: MODEL_DEGRADATION (high severity)

The model appears to be in a degraded state with malformed tool calls.
Consider:
1. Send recovery message first
2. Abort if no improvement

Run: worktree_abort({ "sessionID": "ses_abc123" })
```

## Defaults and safety

- Default worktree path (when `path` is omitted):
  - `<repo>/.worktrees/<branch>`
- Relative `path` inputs are resolved under `.worktrees/` to prevent traversal.
- Branch name is derived from `name` when `branch` is omitted (lowercased, spaces to `-`).
- `worktree_cleanup` refuses to delete dirty worktrees unless `force: true`.
- All tools return readable output with explicit paths and git commands.

## Session workflow

`worktree_make` actions (`start`, `open`, `fork`, `swarm`) create or reuse a worktree, then create a session in that directory.
Each action records a mapping entry at:

- `~/.config/opencode/open-coordinator/state.json` (or `${XDG_CONFIG_HOME}/opencode/open-coordinator/state.json`)

The session title defaults to `wt:<branch>`, and the output includes the session ID plus next steps.

Session mappings include:
- `sessionID` - The spawned session
- `worktreePath` - Path to the worktree
- `branch` - Branch name
- `parentSessionID` - Coordinator's session (for `worktree_notify`)
- `task` - Task name (for swarm mode)

### Swarm Mode

Create multiple parallel worktrees/sessions:

```text
worktree_make { 
  "action": "swarm", 
  "tasks": ["auth-setup", "db-schema", "api-routes"],
  "agent": "implementation-specialist",
  "prompt": "Your task: {{task}}. Read tasks/{{task}}.md for details."
}
```

Each task gets:
- Fresh worktree: `.worktrees/wt/<task>`
- Fresh session with no inherited context
- Initial prompt with `{{task}}` substituted
- Mapping in state.json with parentSessionID

Swarm safety notes:

- `worktree_make` with `action: "swarm"` refuses to reuse existing branches or paths unless `force: true`.
- It never deletes existing worktrees; it only creates new ones.

Optional command file examples:

```text
# .opencode/command/worktree.md
worktree_mode { "action": "$1" }
```

```text
# .opencode/command/worktree-start.md
worktree_make { "action": "start", "name": "$1", "openSessions": true }
```

```text
# .opencode/command/worktree-open.md
worktree_make { "action": "open", "pathOrBranch": "$1", "openSessions": true }
```

Slash commands (drop these files into `.opencode/command`):

```text
/worktree on
/worktree off
/worktree-overview
/worktree-make <name>
/worktree-clean <pathOrBranch>
```

## Development

E2E tests exercise the CLI against a temporary OpenCode config file.

```bash
bun run lint
bun run typecheck
bun run build
bun run test
bun run test:e2e
bun pm scan
npm audit --omit=dev
```

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
