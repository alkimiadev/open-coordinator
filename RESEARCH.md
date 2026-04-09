# Research: Open-Coordinator Plugin

## Overview

Open-Coordinator is an OpenCode plugin for managing git worktrees and parallel agent sessions. It provides a set of tools to create, manage, and clean up git worktrees, along with OpenCode session management.

**Repository**: `dev/open-coordinator/` (forked from https://github.com/opencode-ai/open-coordinator)
**Version**: 1.0.1
**License**: MIT

---

## Plugin Architecture

### Entry Point (`src/index.ts`)

The plugin exports a default function that initializes tools and sets up event handling:

```typescript
const OpenTreesPlugin: Plugin = async (ctx) => ({
  tool: createTools(ctx),           // Register all worktree tools
  event: async ({ event }) => {     // Handle session deletion cleanup
    const sessionID = getDeletedSessionId(event);
    if (!sessionID) return;
    await removeSessionMappings(sessionID);
  },
});
```

### Tool Registration (`src/tools.ts`)

Tools are gated behind "worktree mode" using `runWhenEnabled()` wrapper. The four main tools are:

| Tool | Purpose | Mode Required |
|------|---------|---------------|
| `worktree_mode` | Enable/disable worktree mode, show help | No |
| `worktree_overview` | List, status, or dashboard view of worktrees | Yes |
| `worktree_make` | Create, start, open, fork worktrees and sessions | Yes |
| `worktree_cleanup` | Remove or prune worktrees | Yes |

---

## Tool Descriptions

### 1. `worktree_mode`

**Purpose**: Toggle worktree mode on/off and display help.

**Actions**:
- `on` - Enable worktree mode
- `off` - Disable worktree mode
- `status` - Show current mode status (default)
- `help` - Show help sheet

**Behavior**:
- Writes mode state to `~/.config/opencode/open-coordinator/mode.json`
- Prints help sheet with available tools and examples
- Other tools check mode before executing via `ensureModeEnabled()`

### 2. `worktree_overview`

**Purpose**: Provide different views of worktrees.

**Views**:
- `list` (default) - Table of all worktrees with branch, path, HEAD, lock status
- `status` - Git status for worktrees (clean/dirty, staged, unstaged, untracked)
- `dashboard` - Aggregated view of worktree + session mappings

**Status Options**:
- `path` - Filter to specific worktree
- `all` - Include all known worktrees
- `porcelain` - Include raw git status output

### 3. `worktree_make`

**Purpose**: Create and manage worktrees with OpenCode sessions.

**Actions**:

| Action | Description |
|--------|-------------|
| `create` | Create a new worktree (no session) |
| `start` | Create or reuse worktree + create new session |
| `open` | Open session in existing worktree |
| `fork` | Fork current session into new worktree |
| `swarm` | Create multiple worktrees/sessions from task list |

**Key Parameters**:
- `name` - Logical name (used to derive branch: lowercase, spaces→`-`)
- `branch` - Explicit branch name (overrides derived name)
- `base` - Base ref for new branch (default: `HEAD`)
- `path` - Explicit filesystem path for worktree
- `pathOrBranch` - Existing worktree path or branch to open
- `openSessions` - Open sessions UI after creation

**Session Title Convention**: `wt:<branch>`

**State Persistence**: Session mappings stored in `~/.config/opencode/open-coordinator/state.json`:
```json
{
  "entries": [
    {
      "worktreePath": "/path/to/worktree",
      "branch": "feature/audit",
      "sessionID": "sess-123",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 4. `worktree_cleanup`

**Purpose**: Remove worktrees safely.

**Actions**:
- `remove` - Remove specific worktree (requires `pathOrBranch`)
- `prune` - Remove stale worktree references

**Safety Features**:
- Refuses to delete dirty worktrees unless `force: true`
- Validates worktree exists before removal
- Dry-run option for prune

---

## Default Path Behavior

### Worktree Path Resolution

**Default Pattern**: `<repo>/.worktrees/<branch>`

The `paths.ts` module handles path resolution:

```typescript
export const getWorktreeRoot = (repoRoot: string) => 
  path.join(repoRoot, ".worktrees");

export const defaultWorktreePath = (repoRoot: string, branch: string) =>
  path.join(getWorktreeRoot(repoRoot), branch);
```

**Relative Path Resolution**:
- Relative paths are resolved under `.worktrees/` to prevent traversal attacks
- Absolute paths are accepted as-is
- Path traversal outside worktree root is blocked

Example:
```typescript
// Relative path
resolveWorktreePath("/repo", "feature-a")  
// → "/repo/.worktrees/feature-a"

// Path traversal blocked
resolveWorktreePath("/repo", "../escape")
// → Error: "Worktree path must stay within the worktree root"
```

---

## Current Limitations

### 1. **Worktree Path Friction (Primary Pain Point)**

**Problem**: Agents must always supply the full worktree path to bash commands via the `workdir` parameter.

**Current Flow**:
```
1. Create worktree: worktree_make { "action": "start", "name": "feature audit" }
2. Tool returns: "Worktree: /workspace/repo/.worktrees/feature-audit"
3. Run commands: bash { "command": "ls", "workdir": "/workspace/repo/.worktrees/feature-audit" }
4. Every subsequent command must repeat the full path
```

**Friction Points**:
- Agent must parse/remember the full path from tool output
- No automatic context switching to the worktree directory
- Each bash command requires explicit `workdir` parameter
- Path is long and repetitive: `<repo>/.worktrees/<branch>`

**Evidence from Code**:
- The plugin creates worktrees and sessions but does not modify the agent's working directory context
- The bash tool's `workdir` parameter is the only mechanism to change directory
- No plugin-exposed way to get the "current" worktree path

### 2. **No Active Worktree Context**

The plugin tracks session-to-worktree mappings in state, but:
- No "active" or "current" worktree concept
- No tool to query "what's the worktree for current session?"
- Dashboard shows all mappings, not just current session's

### 3. **Session Discovery**

- `openSessions: true` opens UI but doesn't auto-select
- Finding session ID requires scanning dashboard output
- No quick "switch to worktree X's session" command

### 4. **Branch Name Derivation**

- Automatic derivation from `name` is convenient but can be unexpected
- No confirmation of derived branch name before creation
- Collisions only detected at creation time

### 5. **State Management**

- State is local to machine (`~/.config/opencode/open-coordinator/`)
- No synchronization across multiple OpenCode instances
- Manual cleanup if state gets out of sync

---

## Potential Improvement Opportunities

### 1. **Automatic Working Directory Context**

**Idea**: When a session is created in a worktree, automatically set the working directory context.

**Approaches**:

**A. Session-level workdir tracking**
- Store worktree path in session metadata
- Bash tool automatically uses session's workdir if not overridden

**B. Environment variable injection**
- Set `OPENCODE_WORKTREE_PATH` environment variable
- Agent can reference `$OPENCODE_WORKTREE_PATH` in commands

**C. Tool to get current worktree path**
```typescript
// New tool: worktree_current
{
  worktreePath: "/workspace/repo/.worktrees/feature-audit",
  branch: "feature-audit",
  sessionID: "sess-123"
}
```

### 2. **Simplified Path References**

**Idea**: Allow referencing worktrees by shorthand names instead of full paths.

**Approaches**:

**A. Branch-only references**
- Allow `workdir: "feature-audit"` instead of full path
- Plugin resolves branch to path

**B. Named worktrees**
- Allow naming worktrees at creation: `name: "auth-fix"`
- Reference by name: `workdir: "auth-fix"`

### 3. **Active Worktree Selection**

**Idea**: Add a concept of "active" worktree for the current session.

```typescript
// New tool: worktree_use
worktree_use { "pathOrBranch": "feature-audit" }
// Sets active worktree for current session
// Subsequent commands use this worktree by default
```

### 4. **Integration with Bash Tool**

**Idea**: Extend bash tool to understand worktree references.

```typescript
bash { 
  "command": "npm test",
  "worktree": "feature-audit"  // New parameter: resolves to path
}
```

### 5. **Configuration Options**

Current configuration is minimal. Potential additions:

```json
{
  "open-coordinator": {
    "defaultWorktreeRoot": ".worktrees",
    "autoOpenSessions": true,
    "sessionTitleTemplate": "wt:{branch}",
    "setWorkingDirectory": true  // Auto-set bash workdir
  }
}
```

---

## Configuration Options

### Current Configuration

The plugin has minimal configuration:

**State Files**:
- `~/.config/opencode/open-coordinator/mode.json` - Mode on/off state
- `~/.config/opencode/open-coordinator/state.json` - Session mappings

**Environment Variables**:
- `XDG_CONFIG_HOME` - Custom config directory location

### No Runtime Configuration

The plugin does **not** currently support:
- Custom default worktree root (hardcoded to `.worktrees`)
- Auto-workdir behavior settings
- Branch naming templates
- Session behavior defaults

---

## Integration Points

### OpenCode SDK Usage

The plugin uses OpenCode SDK for:

```typescript
// Session management
ctx.client.session.create({ query: { directory }, body: { title } })
ctx.client.session.fork({ path: { id }, query: { directory } })
ctx.client.session.update({ path: { id }, body: { title } })
ctx.client.session.get({ path: { id } })

// UI
ctx.client.tui.openSessions()

// Context
ctx.worktree  // Current worktree path
ctx.$         // Shell execution
ctx.$.cwd(path) // Shell with working directory
```

### Git Integration

Git commands executed via `runGit()`:
- `git rev-parse --show-toplevel` - Get repo root
- `git worktree list --porcelain` - List worktrees
- `git worktree add` - Create worktree
- `git worktree remove` - Remove worktree
- `git worktree prune` - Prune stale refs
- `git status --porcelain` - Check status
- `git check-ref-format` - Validate branch names
- `git show-ref` - Check branch existence

---

## Summary

### Strengths

1. **Clean separation** - Mode gating prevents tool clutter
2. **Safety first** - Validates paths, checks dirty status, prevents traversal
3. **Good defaults** - Sensible branch derivation and path conventions
4. **State persistence** - Tracks session-to-worktree mappings
5. **Comprehensive** - Covers create, manage, cleanup workflows

### Key Limitation: Path Friction

The primary pain point is that **agents must manually track and supply full worktree paths** for every bash command. There's no mechanism to:
- Automatically set working directory when entering a worktree session
- Reference worktrees by shorthand
- Query the current session's worktree path

### Recommended Improvements

1. **Add `worktree_current` tool** - Returns current session's worktree info
2. **Support branch-only workdir references** - Allow `workdir: "branch-name"`
3. **Add configuration for auto-workdir** - Optionally set bash default directory
4. **Environment variable injection** - Set `OPENCODE_WORKTREE_PATH` in sessions

---

## References

- Source: `/workspace/open-coordinator/src/`
- README: `/workspace/open-coordinator/README.md`
- Documentation: `/workspace/open-coordinator/docs/`
- Tests: `/workspace/open-coordinator/tests/`
- Package: `/workspace/open-coordinator/package.json`
