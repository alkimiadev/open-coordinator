# Open Coordinator: Architecture

## Overview

This is a fork of the [open-trees](https://github.com/0xSero/open-trees) plugin by 0xSero with enhancements for coordinated development workflows using git worktrees in OpenCode.

**Original**: https://github.com/0xSero/open-trees
**Fork**: https://github.com/alkimiadev/open-coordinator
**Purpose**: Development tool to improve agent productivity with coordinated worktree workflows

## Implementation Status

✅ **Completed:**
- Plugin hooks (`tool.execute.before`, `shell.env`, `experimental.session.compacting`) in `src/index.ts`
- Fresh sessions using `session.create()` in `src/worktree-session.ts` and `src/worktree-swarm.ts`
- `worktree_spawn` tool in `src/worktree-spawn.ts`
- Session management tools (inline in `src/tools.ts`):
  - `worktree_message` - Send messages to spawned sessions
  - `worktree_notify` - Send messages back to coordinator
  - `worktree_status` - Query spawned session status
  - `worktree_abort` - Abort spawned sessions
  - `worktree_current` - Query current session's worktree mapping
- State management with `parentSessionID` and `task` fields in `src/state.ts`
- SSE monitoring/detection in `src/detection/`:
  - Real-time anomaly detection via SSE event stream
  - Model degradation detection (malformed tool calls)
  - High error count detection
  - Session stall detection
  - Coordinator notifications with actionable suggestions
- Comprehensive test infrastructure in `tests/`

⚠️ **Note:** Session management tools are implemented inline in `src/tools.ts` rather than in separate files as originally planned. This is a reasonable choice given their small scope.

## Problem Statement

The original open-trees plugin has several friction points:

### 1. Path Management

Agents must **always specify the full worktree path** for every bash command:

```typescript
// Current painful pattern
bash({ 
  command: "deno test", 
  workdir: "/workspace/repo/.worktrees/feat/my-feature/" 
})
// Must repeat for EVERY command
```

### 2. Session Spawning

The original `worktree_make swarm` uses `session.fork()`, which inherits context from the coordinator's session. This pollutes child sessions with unrelated conversation history.

### 3. Session Communication

No bidirectional communication:
- **Coordinator → Agent**: No way to send messages for recovery, intervention, or check-ins
- **Agent → Coordinator**: No way to report completion, blocking issues, or request guidance

## Solution

Four-pronged approach using OpenCode plugin hooks and server API:

1. **Plugin Hooks** - Automatic workdir injection via `tool.execute.before` and `shell.env`
2. **Fresh Sessions** - Use `session.create()` instead of `session.fork()` for clean context
3. **Coordinator → Agent** - Use `session.promptAsync()` for non-blocking messages to spawned sessions
4. **Agent → Coordinator** - Use `worktree_notify` to send messages to the parent session

## Architecture

### Component 1: Plugin Hooks

Registered on plugin load, these hooks intercept tool execution and shell commands:

#### `tool.execute.before`

Automatically injects `workdir` for bash commands when the session is mapped to a worktree:

```typescript
"tool.execute.before": async (input, output) => {
  if (input.tool === "bash" && input.sessionID) {
    const entry = await findSessionEntry(input.sessionID);
    if (entry && !output.args.workdir) {
      output.args.workdir = entry.worktreePath;
    }
  }
}
```

**Behavior**:
- Checks if session has a worktree mapping in `state.json`
- Only injects if `workdir` not already specified (respects explicit overrides)
- Agent never needs to think about paths

#### `shell.env`

Injects environment variables for shell commands:

```typescript
"shell.env": async (input, output) => {
  if (input.sessionID) {
    const entry = await findSessionEntry(input.sessionID);
    if (entry) {
      output.env.OPENCODE_WORKTREE_PATH = entry.worktreePath;
      output.env.OPENCODE_WORKTREE_BRANCH = entry.branch;
    }
  }
}
```

**Available Environment Variables**:
- `OPENCODE_WORKTREE_PATH` - Full path to worktree
- `OPENCODE_WORKTREE_BRANCH` - Branch name

### Component 2: `worktree_spawn` Tool

Creates worktrees and fresh sessions, then sends initial prompts asynchronously.

```typescript
worktree_spawn({
  tasks: ["auth-setup", "db-schema"],
  prefix: "feat/",
  agent: "implementation-specialist",
  prompt: "Your task: {{task}}. Read tasks/{{task}}.md for details.",
})
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tasks` | `string[]` | Yes | Task names/IDs to spawn |
| `prefix` | `string` | No | Branch prefix (default: `"wt/"`) |
| `agent` | `string` | No | Agent to use for sessions |
| `prompt` | `string` | No | Prompt template, `{{task}}` substituted |
| `model` | `{ providerID, modelID }` | No | Model override |

**Process**:

1. For each task:
   - Create worktree via `git worktree add .worktrees/<prefix><task>`
   - Create **fresh session** via `ctx.client.session.create({ query: { directory: worktreePath } })`
   - Store mapping in `state.json`: `{ sessionID, worktreePath, branch, parentSessionID }`
   - Send initial prompt via `ctx.client.session.promptAsync()`

2. Return immediately with session info:

```typescript
{
  spawned: [
    { task: "auth-setup", sessionID: "ses_abc...", branch: "feat/auth-setup", worktreePath: "..." },
    { task: "db-schema", sessionID: "ses_xyz...", branch: "feat/db-schema", worktreePath: "..." }
  ]
}
```

**Key Difference from Original**:
- Uses `session.create()` instead of `session.fork()`
- Child sessions have **no inherited context** from coordinator
- Each session is focused solely on its assigned task

### Component 3: `worktree_message` Tool

Send messages to spawned sessions for recovery, check-ins, or intervention.

```typescript
worktree_message({
  sessionID: "ses_abc...",
  message: "There was an error parsing the tool call. Please try again."
})
```

Or with an agent specification:

```typescript
worktree_message({
  sessionID: "ses_abc...",
  message: "Continue from where you left off.",
  agent: "implementation-specialist"
})
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionID` | `string` | Yes | Target session ID |
| `message` | `string` | Yes | Message content |
| `agent` | `string` | No | Agent to use (optional) |

**Use Cases**:
- Recovery from parsing errors
- Breaking infinite loops (before aborting)
- Status check-ins
- Redirecting stuck agents

### Component 4: `worktree_status` Tool

Query status of spawned sessions.

```typescript
worktree_status({
  sessionIDs: ["ses_abc...", "ses_xyz..."]  // optional, defaults to all mapped
})
```

**Returns**:

```typescript
{
  sessions: [
    {
      sessionID: "ses_abc...",
      status: "busy",
      branch: "feat/auth-setup",
      worktreePath: ".worktrees/feat/auth-setup",
      lastMessage: "Running tests..."
    },
    {
      sessionID: "ses_xyz...",
      status: "idle",
      branch: "feat/db-schema",
      worktreePath: ".worktrees/feat/db-schema",
      completed: true
    }
  ]
}
```

**Implementation**:
- Uses `ctx.client.session.status()` for status
- Uses `ctx.client.session.messages()` for recent activity
- Cross-references with `state.json` for worktree info

### Component 5: `worktree_notify` Tool

Allow spawned sessions to send messages back to the coordinator.

```typescript
worktree_notify({
  message: "Task completed successfully",
  level: "info"
})
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | `string` | Yes | Message content |
| `level` | `"info" \| "warning" \| "blocking"` | No | Priority level (default: `"info"`) |

**Message Levels**:
- `info` - Status updates, completion notices
- `warning` - Potential issues, non-blocking problems
- `blocking` - Cannot proceed, needs coordinator intervention

**Message Format** (what coordinator receives):

```
[feat/auth-setup] Task completed successfully.

Session: ses_abc123
Branch: feat/auth-setup
```

Or for blocking issues:

```
⚠️ BLOCKING [feat/auth-setup] Missing dependency: oauth-library

Session: ses_abc123
Branch: feat/auth-setup

Cannot proceed without oauth-library installed.
Please advise on approach.
```

**Implementation**:

1. Get current `sessionID` from tool context
2. Look up entry in `state.json` to find `parentSessionID`
3. Build formatted message with branch/task context
4. Send via `ctx.client.session.promptAsync({ path: { id: parentSessionID }, body: { parts: [...] } })`

**State Schema**:

```typescript
type WorktreeSessionEntry = {
  worktreePath: string;
  branch: string;
  sessionID: string;           // Spawned session
  parentSessionID?: string;     // Coordinator's session (set by worktree_spawn)
  task?: string;                // Task name (for context in notifications)
  createdAt: string;
};
```

**Use Cases**:
- Task completion notification
- Blocking issues requiring guidance
- Questions about requirements
- Status updates during long-running work

### Existing Tools (Enhanced)

#### `worktree_current` (New)

Query the worktree mapping for the current session:

```typescript
worktree_current({})

// Returns
{
  worktreePath: "/workspace/repo/.worktrees/feat/my-feature",
  branch: "feat/my-feature",
  sessionID: "ses_abc123",
  relativePath: ".worktrees/feat/my-feature"
}
```

Useful for agents that need to know their context explicitly.

#### `worktree_make` (Enhanced)

Existing actions remain, but `start` and `swarm` updated to use fresh sessions:

```typescript
// Still works, but now uses session.create() instead of session.fork()
worktree_make({ action: "start", name: "my-feature" })

// Enhanced swarm
worktree_make({ 
  action: "swarm", 
  tasks: ["auth", "db"],
  agent: "implementation-specialist",
  prompt: "Task: {{task}}"
})
```

### Component 6: `worktree_abort` Tool

Abort a spawned session that is stuck, degraded, or needs intervention.

```typescript
worktree_abort({
  sessionID: "ses_abc..."
})
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionID` | `string` | Yes | Session to abort |

**Implementation**:
```typescript
await ctx.client.session.abort({
  path: { id: sessionID }
});
```

**Use Cases**:
- Model degradation detected → abort and restart
- Infinite loop → abort and investigate
- Wrong direction → abort and provide new guidance

### Component 7: Detection & Monitoring

Real-time anomaly detection via SSE event subscription.

#### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Plugin Load → Subscribe to global.event() SSE                        │
│                                                                     │
│ On event:                                                           │
│   - Filter for sessions in state.json (spawned by coordinator)      │
│   - Track metrics per session                                       │
│   - Notify coordinator when thresholds exceeded                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Detection Heuristics

Based on analysis of historical failure patterns:

| Heuristic | Condition | Severity | Action |
|-----------|-----------|----------|--------|
| **Malformed tool name** | `tool === "tool"` (not a real tool name) | High | Likely model degradation, consider abort |
| **High error count** | >5 tool errors in a session | Medium | Check session, may need recovery |
| **Raw token leakage** | Reasoning contains `<\|tool` | Medium | Model degradation signal |
| **Session stall** | No activity for 60s while status="busy" | Medium | Send recovery message |
| **MessageAbortedError** | Multiple aborted messages | Low | User likely intervened |

#### Failure Modes

**Mode 1: Model Degradation**
- Provider serves heavily quantized/broken model
- Malformed tool calls, raw tokens in output
- Incoherent text (sometimes wrong language)
- **Action**: Abort and restart with different model

**Mode 2: Session Stall (OpenCode parsing bug)**
- OpenCode fails to parse a valid tool call
- Session unexpectedly becomes idle
- Model is fine, just needs a nudge
- **Action**: Send "please continue" message

**Mode 3: Tool Errors**
- Accumulation of failed tool calls
- Could be legitimate errors or systemic issue
- **Action**: Check session, send guidance if needed

#### Implementation

```typescript
// Track metrics per session
const sessionMetrics = new Map<string, {
  toolErrors: number;
  malformedTools: number;
  abortedMessages: number;
  lastActivityTime: number;
  lastStatus: 'busy' | 'idle';
}>();

// SSE handler (runs asynchronously, non-blocking)
const eventStream = ctx.client.global.event();
for await (const event of eventStream) {
  const sessionID = event.properties?.sessionID || event.properties?.info?.id;
  
  // Only monitor spawned sessions
  if (!isSpawnedSession(sessionID)) continue;
  
  const metrics = sessionMetrics.get(sessionID) || {
    toolErrors: 0,
    malformedTools: 0,
    abortedMessages: 0,
    lastActivityTime: Date.now(),
    lastStatus: 'idle'
  };
  
  // Update activity time for all events
  metrics.lastActivityTime = Date.now();
  
  // Track session status
  if (event.type === 'session.status') {
    metrics.lastStatus = event.properties.status.type;
  }
  
  // Track malformed tool names (model degradation)
  if (event.type === "message.part.updated") {
    const part = event.properties.part;
    
    if (part.type === "tool" && part.tool === "tool") {
      metrics.malformedTools++;
      if (metrics.malformedTools >= 1) {
        notifyCoordinator(sessionID, "MODEL_DEGRADATION", {
          issue: "Malformed tool calls detected",
          severity: "high",
          suggestion: "Consider aborting and switching models"
        });
      }
    }
    
    // Track tool errors
    if (part.type === "tool" && part.state?.status === "error") {
      metrics.toolErrors++;
      if (metrics.toolErrors >= 5) {
        notifyCoordinator(sessionID, "HIGH_ERROR_COUNT", {
          count: metrics.toolErrors,
          severity: "medium",
          suggestion: "Check session for systemic issues"
        });
      }
    }
  }
  
  sessionMetrics.set(sessionID, metrics);
}

// Periodic stall detection (runs every 30s)
const STALL_THRESHOLD_MS = 60_000; // 1 minute
setInterval(() => {
  const now = Date.now();
  
  for (const [sessionID, metrics] of sessionMetrics) {
    // Check for stalled sessions (busy but no activity)
    if (metrics.lastStatus === 'busy' && 
        (now - metrics.lastActivityTime) > STALL_THRESHOLD_MS) {
      notifyCoordinator(sessionID, "SESSION_STALL", {
        lastActivity: metrics.lastActivityTime,
        severity: "medium",
        suggestion: "Session may be stalled. Send recovery message: 'please continue'"
      });
    }
  }
}, 30_000);
```

#### Notification Format

**Model Degradation**:
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

**Session Stall**:
```
⚠️ SESSION STALLED [feat/auth-setup]

Session: ses_abc123
Branch: feat/auth-setup
Issue: No activity for 90 seconds while session is busy

This may be an OpenCode parsing bug. The model can usually recover.
Consider sending: "There was an error, please continue."

Run: worktree_message({ "sessionID": "ses_abc123", "message": "please continue" })
```

#### Key Design Principles

1. **Non-blocking**: Detection runs on SSE stream, doesn't block tool execution
2. **Notify, don't auto-recover**: Coordinator decides action (abort, message, ignore)
3. **Simple heuristics**: Start with clear patterns, refine over time
4. **Session-scoped**: Only monitor sessions spawned by coordinator

### File Structure

**Current Implementation:**
```

├── src/
│   ├── index.ts                    # Plugin entry point + hooks
│   ├── tools.ts                    # Tool registration + inline implementations:
│   │                                #   - worktree_message (lines 275-294)
│   │                                #   - worktree_notify (lines 295-330)
│   │                                #   - worktree_status (lines 331-360)
│   │                                #   - worktree_abort (lines 361-374)
│   │                                #   - worktree_current (lines 375-399)
│   ├── worktree-spawn.ts           # Spawn tool implementation
│   ├── worktree-session.ts         # Enhanced: uses session.create()
│   ├── worktree-swarm.ts           # Enhanced: uses session.create()
│   ├── worktree-status.ts          # Git worktree status (distinct from worktree_status tool)
│   ├── worktree.ts
│   ├── worktree-helpers.ts
│   ├── worktree-dashboard.ts
│   ├── state.ts                    # Session-to-worktree mappings (with parentSessionID, task)
│   ├── git.ts
│   ├── paths.ts
│   ├── format.ts
│   ├── result.ts
│   ├── sdk.ts
│   ├── mode.ts
│   ├── config.ts
│   ├── session-helpers.ts
│   ├── opencode-config.ts
│   ├── cli.ts
│   └── types.ts
│   ├── detection/                  # NOT YET IMPLEMENTED: anomaly detection
│   │   ├── index.ts                # SSE subscription + metrics
│   │   ├── heuristics.ts           # Detection rules
│   │   └── notify.ts               # Coordinator notifications
├── tests/
│   ├── helpers.ts                  # Mock utilities and test setup
│   ├── README.md                   # Testing guide
│   ├── *.test.ts                   # Unit and integration tests
│   └── e2e.test.ts                 # End-to-end CLI tests
├── ARCHITECTURE.md
├── RESEARCH.md
└── package.json
```

**Note:** The architecture originally planned separate files for each session management tool, but they were implemented inline in `tools.ts` given their small scope. This is a reasonable simplification. The `worktree-status.ts` file handles git worktree status operations (running `git status --porcelain`), which is distinct from the `worktree_status` tool that queries spawned session state from `state.json`.

## Implementation Phases

### Phase 1: Plugin Hooks ✅ COMPLETED

**Goal**: Automatic workdir injection

**Changes**:
1. Add `tool.execute.before` hook in `src/index.ts`
2. Add `shell.env` hook in `src/index.ts`
3. Create `findSessionEntry()` helper in `src/state.ts`

**Testing**:
```bash
worktree_mode { "action": "on" }
worktree_make { "action": "start", "name": "test-feature" }
# In spawned session:
bash { "command": "pwd" }  # Should show worktree path without explicit workdir
bash { "command": "echo $OPENCODE_WORKTREE_PATH" }  # Should print path
```

**Status**: Implemented and tested. Hooks work correctly for sessions with worktree mappings.

### Phase 2: Fresh Sessions ✅ COMPLETED

**Goal**: Use `session.create()` instead of `session.fork()`

**Changes**:
1. Modify `startWorktreeSession()` in `src/worktree-session.ts`
2. Modify `swarmWorktrees()` in `src/worktree-swarm.ts`
3. Use `ctx.client.session.create({ query: { directory } })` instead of fork

**Testing**:
```bash
# Spawn a session
worktree_make { "action": "start", "name": "fresh-test" }
# Verify session has no parent/coordinator context
```

**Status**: Implemented. Both `startWorktreeSession` and `swarmWorktrees` now use `session.create()`.

### Phase 3: `worktree_spawn` Tool ✅ COMPLETED

**Goal**: Combined worktree + session + prompt

**Changes**:
1. Create `src/worktree-spawn.ts`
2. Register tool in `src/tools.ts`
3. Implement async prompt via `ctx.client.session.promptAsync()`

**Testing**:
```bash
worktree_spawn {
  "tasks": ["test-task"],
  "prefix": "feat/",
  "agent": "build",
  "prompt": "Task: {{task}}"
}
# Should return immediately with session ID
# Session should be running in background
```

**Status**: Implemented with template substitution. Tests cover pure functions.

### Phase 4: `worktree_message` Tool ✅ COMPLETED

**Goal**: Send messages to sessions

**Changes**:
1. Implemented inline in `src/tools.ts` (lines 275-294)
2. Uses `ctx.client.session.promptAsync()` for message delivery

**Testing**:
```bash
# Send recovery message
worktree_message {
  "sessionID": "ses_abc...",
  "message": "Please retry the failed tool call"
}
```

**Status**: Implemented inline. Tests pending.

### Phase 5: `worktree_status` Tool ✅ COMPLETED

**Goal**: Query session status

**Changes**:
1. Implemented inline in `src/tools.ts` (lines 331-360)
2. Reads from `state.json` and formats table output

**Testing**:
```bash
worktree_status {}
# Should show all mapped sessions with status
```

**Status**: Implemented inline. Tests pending. Note: distinct from `src/worktree-status.ts` which handles git status.

### Phase 6: `worktree_notify` Tool ✅ COMPLETED

**Goal**: Agents can notify coordinator

**Changes**:
1. Updated `state.ts` to include `parentSessionID` and `task` fields ✅
2. Updated `worktree_spawn` to store parent session ID ✅
3. Implemented inline in `src/tools.ts` (lines 295-330)
4. Formats messages with level prefixes and task context

**Testing**:
```bash
# In spawned session:
worktree_notify {
  "message": "Task completed",
  "level": "info"
}
# Coordinator should receive formatted message
```

**Status**: Implemented inline. State enhancements tested. Tool tests pending.

### Phase 7: `worktree_abort` Tool ✅ COMPLETED

**Goal**: Abort stuck or degraded sessions

**Changes**:
1. Implemented inline in `src/tools.ts` (lines 361-374)
2. Uses `ctx.client.session.abort()` API

**Testing**:
```bash
worktree_abort {
  "sessionID": "ses_abc..."
}
# Session should be aborted
```

**Status**: Implemented inline. Tests pending.

### Phase 8: Detection & Monitoring ✅ COMPLETED

**Goal**: Detect anomalies in spawned sessions

**Changes**:
1. Created `src/detection/` module:
   - `types.ts` - Type definitions and thresholds
   - `metrics.ts` - Session metrics tracking
   - `heuristics.ts` - Detection rules
   - `notify.ts` - Coordinator notifications
   - `index.ts` - Main detection loop
2. Subscribed to `ctx.client.global.event()` SSE on plugin load
3. Tracking metrics per session (tool errors, malformed tools, activity time, status)
4. Notifying coordinator when thresholds exceeded
5. Periodic stall detection (every 30s)

**Detection Heuristics**:
- **Malformed tool name**: `tool === "tool"` → MODEL_DEGRADATION (high severity)
- **High error count**: >5 tool errors → HIGH_ERROR_COUNT (medium severity)
- **Session stall**: No activity for 60s while busy → SESSION_STALL (medium severity)

**Testing**:
```bash
bun test tests/detection.test.ts
# All detection metrics and heuristics tested
```

**Status**: Fully implemented and tested. Non-blocking async detection loop integrated into plugin initialization. 59 total tests passing.

## Backward Compatibility

All enhancements are **opt-in** or additive:

- Plugin hooks - Always active, but only affect sessions with worktree mappings
- `worktree_spawn` - New tool, doesn't affect existing tools
- `worktree_message` - New tool, doesn't affect existing tools
- `worktree_notify` - New tool, doesn't affect existing tools
- `worktree_status` - New tool, doesn't affect existing tools
- `worktree_abort` - New tool, doesn't affect existing tools
- Detection - Background monitoring, non-blocking
- `session.create` vs `session.fork` - Behavioral change, but same API

Existing `worktree_make` actions remain functional with enhanced behavior.

## Contributing Back Upstream

This fork exists to:
1. Solve immediate friction for development workflows
2. Experiment with enhancements
3. Contribute improvements back to open-trees

**Contribution Strategy**:
1. Implement and test in fork
2. Extract clean diffs for each enhancement
3. Submit focused PRs upstream:
   - PR 1: Plugin hooks for auto-workdir
   - PR 2: Fresh sessions via `session.create()`
   - PR 3: `worktree_spawn` tool
   - PR 4: `worktree_message` tool
   - PR 5: `worktree_status` tool
   - PR 6: `worktree_notify` tool (bidirectional communication)
   - PR 7: `worktree_abort` tool
   - PR 8: Detection & monitoring (optional, may be too specific)

## Usage Example

### Coordinator Workflow

```typescript
// 1. Enable worktree mode
worktree_mode({ "action": "on" })

// 2. Spawn parallel tasks
const result = worktree_spawn({
  tasks: ["auth-setup", "db-schema", "api-routes"],
  prefix: "feat/",
  agent: "implementation-specialist",
  prompt: "Your task: {{task}}. Read tasks/{{task}}.md for details. Update the task file's status field as you progress."
})

// 3. Monitor progress (or wait for notifications)
worktree_status({})

// 4a. Recovery message if degraded
worktree_message({
  sessionID: "ses_abc...",
  message: "There was a parsing error. Please retry."
})

// 4b. Abort if unrecoverable
worktree_abort({
  sessionID: "ses_abc..."
})

// 5. Cleanup when done
worktree_cleanup({ "action": "remove", "pathOrBranch": "feat/auth-setup" })
```

**Detection notifications** appear automatically in coordinator's session when anomalies detected.

### Implementation Specialist (in spawned session)

```typescript
// Commands work automatically in worktree - no workdir needed
bash({ "command": "npm test" })
bash({ "command": "git status" })

// Environment variables available
bash({ "command": "echo $OPENCODE_WORKTREE_PATH" })
bash({ "command": "echo $OPENCODE_WORKTREE_BRANCH" })

// Notify coordinator of progress/issues
worktree_notify({
  message: "Tests passing, starting implementation",
  level: "info"
})

// Report blocking issues
worktree_notify({
  message: "Missing type definitions for oauth library. Please advise on approach.",
  level: "blocking"
})

// Report completion
worktree_notify({
  message: "Task completed. All tests passing.",
  level: "info"
})
```

## Future Enhancements

### Improved Compaction Prompt

OpenCode's default compaction prompt asks the agent to "summarize for another agent". This is misleading - it's the same agent continuing the same session.

Use the `experimental.session.compacting` hook to provide a better prompt:

```typescript
"experimental.session.compacting": async (input, output) => {
  output.prompt = `You are compacting your own session to free context space.

Include what YOU will need to effectively resume your work:
- Current task and progress
- Files being worked on
- Key decisions made and why
- Next steps to take
- Important context that would be hard to rediscover

Be concise but preserve enough detail that you can continue seamlessly.
You are summarizing for yourself, not another agent.`;
}
```

**Note**: This is a stopgap. The real solution is AUI (Agent UI) which will give agents:
- A session HUD with last N rounds visible
- Tools to search full session history
- Ability to pin/unpin context
- Agency over what they remember

### Session Logging

Store session event logs for debugging and analysis:

```
.worktrees/logs/ses_abc123.jsonl
```

Each line is a JSON event from the SSE stream.

### Database Queries for Research

Read-only queries to OpenCode's SQLite database for pattern analysis:

```bash
sqlite3 "file:$HOME/.local/share/opencode/opencode.db?mode=ro" "
  SELECT s.id, s.title, COUNT(*) as error_count
  FROM part p
  JOIN message m ON m.id = p.message_id
  JOIN session s ON s.id = m.session_id
  WHERE json_extract(p.data, '$.type') = 'tool'
    AND json_extract(p.data, '$.state.status') = 'error'
  GROUP BY s.id
  HAVING error_count > 5;
"
```

Useful for:
- Identifying failure patterns
- Improving detection heuristics
- Researching model/provider quality

### Configurable Thresholds

Allow customization of detection thresholds:

```json
{
  "open-trees": {
    "detection": {
      "toolErrorThreshold": 5,
      "malformedToolThreshold": 1,
      "enableNotifications": true
    }
  }
}
```

## References

- Original Plugin: https://github.com/alkimiadev/open-coordinator
- OpenCode Plugin Docs: https://opencode.ai/docs/plugins/
- OpenCode Server API: https://opencode.ai/docs/server/
- SDK Source: `/workspace/opencode/packages/sdk/`
- Plugin Types: `/workspace/opencode/packages/plugin/src/index.ts`