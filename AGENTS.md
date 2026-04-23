# AGENTS.md

## Worktree Tools (via @alkdev/open-coordinator plugin)

You have access to a single `worktree` tool for managing git worktree workflows. Call with `{action: "<operation>", args: {...}}`.

### Available Operations

Call `worktree({action: "help"})` to see all available operations, or `worktree({action: "help", args: {action: "spawn"}})` for details on a specific operation.

### Role Detection

Your role is determined automatically:
- **Coordinator** (default): You can use all operations — create, spawn, swarm, manage, and cleanup worktrees
- **Implementation** (spawned session): You can only use `current`, `notify`, `status`, and `help` — you cannot create worktrees or manage other sessions

### Key Operations (Coordinator)

- `worktree({action: "spawn", args: {tasks: ["task1", "task2"], prompt: "Your task: {{task}}"}})` — Spawn parallel worktrees with async prompts
- `worktree({action: "sessions"})` — Check spawned session status
- `worktree({action: "message", args: {sessionID: "ses_...", message: "..."}})` — Send message to a spawned session
- `worktree({action: "abort", args: {sessionID: "ses_..."}})` — Abort a stuck session
- `worktree({action: "cleanup", args: {action: "prune"}})` — Prune stale worktree entries

### Key Operations (Implementation)

- `worktree({action: "current"})` — See your worktree mapping
- `worktree({action: "notify", args: {message: "Done!", level: "info"}})` — Report completion to coordinator
- `worktree({action: "notify", args: {message: "Blocked!", level: "blocking"}})` — Report blocking issue

### Automatic Workdir

If your session is mapped to a worktree, bash commands automatically run in the worktree directory. You do not need to specify `workdir`. Environment variables `OPENCODE_WORKTREE_PATH` and `OPENCODE_WORKTREE_BRANCH` are also available.

### Notification Levels

- `info` — Status updates, completion notices
- `warning` — Non-blocking problems
- `blocking` — Cannot proceed, needs coordinator intervention