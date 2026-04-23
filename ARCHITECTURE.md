# Architecture

## Overview

Open Coordinator is an [OpenCode](https://opencode.ai) plugin for coordinated git worktree workflows. It exposes a single `worktree` tool that uses a registry/router pattern to dispatch operations, with automatic role-based access control.

**Original**: https://github.com/0xSero/open-trees
**Fork**: https://github.com/alkimiadev/open-coordinator

## Single-Tool Registry Pattern

The plugin exposes **one tool** — `worktree` — instead of 10+ individual tools. This follows the same pattern as `@alkdev/open-memory`:

```
LLM calls: worktree({action: "spawn", args: {tasks: ["auth", "db"]}})
                              |
                              v
                    registry.ts: route(action, args, context)
                              |
                              v
                    handlers[action]  <-- Record<string, Handler>
                              |
                              v
                    handlers.spawn(args, context)  --> returns string
```

**Why:**
- Reduces tool namespace bloat (1 tool vs 10+)
- Lower cognitive load for agents selecting tools
- Self-documenting via `worktree({action: "help"})`
- Adding operations = adding a handler entry, not a new tool definition
- Consistent error handling and role gating in one place

## Role-Based Access

Access is determined automatically from `state.json` — no manual mode toggle needed:

| Role | Detection | Available operations |
|------|-----------|---------------------|
| Coordinator | Session NOT in state, or no `parentSessionID` | All 16 operations |
| Implementation | Session IN state WITH `parentSessionID` | `help`, `current`, `notify`, `status` |

This prevents spawned agents from creating recursive worktrees or aborting sessions they don't own.

**Mode gate removed entirely.** The previous `worktree_mode({action: "on/off"})` system has been deleted. All worktree operations work without opt-in.

## Tool Reference

Call `worktree({action: "<operation>", args: {...}})` to use one.

### Coordinator Operations

| Operation | Description | Key args |
|-----------|-------------|----------|
| `help` | Show full reference or details for a specific operation | action (operation name) |
| `list` | List git worktrees | — |
| `status` | Show worktree git status | path, all, porcelain |
| `dashboard` | Worktree dashboard with session info | — |
| `create` | Create a new worktree branch and checkout | name, branch, base, path |
| `start` | Create worktree + start a fresh session | name, branch, base, path, pathOrBranch, openSessions |
| `open` | Open existing worktree in a new session | pathOrBranch, path, name, branch, openSessions |
| `fork` | Create worktree + fork current session context | name, branch, base, path, pathOrBranch, openSessions |
| `swarm` | Create multiple worktrees + sessions for parallel tasks | tasks, prefix, openSessions, force |
| `spawn` | Create worktrees + sessions + send async prompts | tasks, prefix, agent, prompt |
| `message` | Send message to a spawned session | sessionID, message, agent |
| `sessions` | Query status of spawned sessions | sessionIDs (optional filter) |
| `abort` | Abort a spawned session | sessionID |
| `cleanup` | Remove or prune worktrees | action (remove/prune), pathOrBranch, force, dryRun |

### Implementation Operations (also available to coordinator)

| Operation | Description | Key args |
|-----------|-------------|----------|
| `current` | Show current session's worktree mapping | — |
| `notify` | Send message to coordinator session | message, level (info/warning/blocking) |
| `status` | Show worktree git status | path, all, porcelain |
| `help` | Show available operations (filtered by role) | — |

## Plugin Hooks

Registered on plugin load. These hooks are always active — no mode toggle needed.

### `tool.execute.before`

Automatically injects `workdir` for bash commands when the session is mapped to a worktree:

```typescript
if (input.tool === "bash" && input.sessionID) {
  const entry = await findSessionEntry(input.sessionID);
  if (entry && !output.args.workdir) {
    output.args.workdir = entry.worktreePath;
  }
}
```

### `shell.env`

Injects environment variables for shell commands in mapped sessions:

- `OPENCODE_WORKTREE_PATH` - Full path to worktree
- `OPENCODE_WORKTREE_BRANCH` - Branch name

### `experimental.session.compacting`

Custom compaction prompt that instructs the agent to summarize for itself (not another agent).

## Detection & Monitoring

Real-time anomaly detection via SSE event subscription. See `src/detection/` for implementation details.

Detection heuristics:

| Heuristic | Condition | Severity |
|-----------|-----------|----------|
| Model Degradation | Malformed tool calls (`tool === "tool"`) | High |
| High Error Count | >5 tool errors in session | Medium |
| Session Stall | No activity for 60s while busy | Medium |

Notifications use the new `worktree` tool syntax:

```
Run: worktree({action: "abort", args: {sessionID: "ses_abc123"}})
Run: worktree({action: "message", args: {sessionID: "ses_abc123", message: "please continue"}})
```

## Session State

Mappings stored at `~/.config/opencode/open-coordinator/state.json`:

```typescript
type WorktreeSessionEntry = {
  worktreePath: string;
  branch: string;
  sessionID: string;
  parentSessionID?: string;   // Set by spawn/swarm for implementation role
  task?: string;               // Task name for swarm sessions
  createdAt: string;
};
```

## File Structure

```
├── src/
│   ├── index.ts              # Plugin entry point + hooks
│   ├── registry.ts           # Handler type, role detection, operation registry, router
│   ├── tools.ts              # Tool registration (single `worktree` tool)
│   ├── worktree-spawn.ts     # Spawn implementation
│   ├── worktree-session.ts   # Start/open/fork session implementations
│   ├── worktree-swarm.ts     # Swarm implementation
│   ├── worktree-status.ts    # Git worktree status
│   ├── worktree-dashboard.ts # Dashboard with session info
│   ├── worktree.ts           # Core worktree operations (create, remove, prune, list)
│   ├── worktree-helpers.ts   # Path matching, directory helpers
│   ├── state.ts              # Session-to-worktree mappings
│   ├── config.ts             # Config root and path helpers
│   ├── git.ts                # Git command runner
│   ├── paths.ts              # Worktree path resolution
│   ├── format.ts             # Formatting and error rendering
│   ├── result.ts             # ToolResult type
│   ├── sdk.ts                # SDK response unwrapping
│   ├── session-helpers.ts    # OpenCode session API helpers
│   ├── cli.ts                # CLI for install command
│   ├── opencode-config.ts    # Config file parser
│   ├── status.ts             # Git status porcelain parser
│   └── detection/            # Anomaly detection
│       ├── index.ts          # SSE subscription + main loop
│       ├── heuristics.ts     # Detection rules
│       ├── metrics.ts        # Per-session metrics tracking
│       ├── notify.ts         # Coordinator notifications
│       └── types.ts          # Type definitions and thresholds
├── tests/
│   ├── registry.test.ts      # Registry routing + role detection tests
│   ├── session-tools.test.ts  # Session mapping tests
│   ├── hooks.test.ts          # Hook behavior tests
│   ├── detection.test.ts      # Detection heuristics tests
│   ├── worktree-spawn.test.ts # Spawn logic tests
│   ├── format.test.ts         # Formatting tests
│   ├── git.test.ts            # Git command tests
│   ├── paths.test.ts          # Path resolution tests
│   ├── sdk.test.ts            # SDK unwrapping tests
│   ├── state.test.ts          # State read/write tests
│   ├── state-enhanced.test.ts # Extended state tests
│   ├── opencode-config.test.ts # Config parser tests
│   ├── cli.test.ts            # CLI tests
│   └── helpers.ts             # Mock utilities
```

## Migrating from the Multi-Tool API

| Old tool | New command |
|----------|-------------|
| `worktree_mode({action: "on"})` | *(removed — no mode gate)* |
| `worktree_overview` | `worktree({action: "list"})` |
| `worktree_overview({view: "status"})` | `worktree({action: "status"})` |
| `worktree_overview({view: "dashboard"})` | `worktree({action: "dashboard"})` |
| `worktree_make({action: "create", name: "feat"})` | `worktree({action: "create", args: {name: "feat"}})` |
| `worktree_make({action: "start", name: "feat"})` | `worktree({action: "start", args: {name: "feat"}})` |
| `worktree_make({action: "open", pathOrBranch: "feat"})` | `worktree({action: "open", args: {pathOrBranch: "feat"}})` |
| `worktree_make({action: "fork", name: "feat"})` | `worktree({action: "fork", args: {name: "feat"}})` |
| `worktree_make({action: "swarm", tasks: [...]})` | `worktree({action: "swarm", args: {tasks: [...]}})` |
| `worktree_spawn({tasks: [...]})` | `worktree({action: "spawn", args: {tasks: [...]}})` |
| `worktree_message({sessionID: "...", message: "..."})` | `worktree({action: "message", args: {sessionID: "...", message: "..."}})` |
| `worktree_notify({message: "Done", level: "info"})` | `worktree({action: "notify", args: {message: "Done", level: "info"}})` |
| `worktree_status({})` | `worktree({action: "sessions"})` |
| `worktree_abort({sessionID: "..."})` | `worktree({action: "abort", args: {sessionID: "..."}})` |
| `worktree_current({})` | `worktree({action: "current"})` |
| `worktree_cleanup({action: "remove", pathOrBranch: "feat"})` | `worktree({action: "cleanup", args: {action: "remove", pathOrBranch: "feat"}})` |
| `worktree_cleanup({action: "prune", dryRun: true})` | `worktree({action: "cleanup", args: {action: "prune", dryRun: true}})` |