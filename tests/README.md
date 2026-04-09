# Testing Guide for Open-Trees Plugin

This guide documents testing patterns and conventions for the open-trees plugin.

## Test Structure

Tests are located in `tests/` directory and follow Bun's test framework conventions.

```
tests/
├── helpers.ts              # Mock utilities and test setup
├── *.test.ts               # Unit tests for pure functions
├── hooks.test.ts           # Integration tests for plugin hooks
├── state-enhanced.test.ts  # Tests for state management enhancements
└── e2e.test.ts             # End-to-end tests for CLI
```

## Running Tests

```bash
bun test                 # Run all tests
bun test tests/state.test.ts  # Run specific test file
bun test --watch         # Run tests in watch mode
```

## Testing Patterns

### 1. Pure Function Tests

Test isolated functions without external dependencies:

```typescript
import { expect, test } from "bun:test";
import { substituteTemplate } from "../src/worktree-spawn";

test("substituteTemplate replaces placeholders", () => {
  expect(substituteTemplate("Task: {{task}}", "auth")).toBe("Task: auth");
});
```

**When to use:** Utility functions, parsers, formatters, validators.

### 2. State/File Operations Tests

Test functions that interact with filesystem or state:

```typescript
import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readState, storeSessionMapping } from "../src/state";

let tempDir: string;
const originalXdg = process.env.XDG_CONFIG_HOME;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "test-"));
  process.env.XDG_CONFIG_HOME = tempDir;
});

afterAll(async () => {
  process.env.XDG_CONFIG_HOME = originalXdg;
  await rm(tempDir, { recursive: true, force: true });
});

test("state operations work", async () => {
  const result = await storeSessionMapping({...});
  expect(result.ok).toBe(true);
});
```

**When to use:** State management, config reading/writing, file operations.

### 3. Plugin Hook Tests

Test plugin hooks by simulating their behavior:

```typescript
test("tool.execute.before injects workdir", async () => {
  // Setup: Create state mapping
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/test",
    sessionID: "sess-1",
    ...
  });

  // Test hook logic
  const entry = await findSessionEntry("sess-1");
  expect(entry?.worktreePath).toBe("/repo/.worktrees/test");

  // Simulate hook application
  const outputArgs = { workdir: undefined };
  if (entry && !outputArgs.workdir) {
    outputArgs.workdir = entry.worktreePath;
  }
  expect(outputArgs.workdir).toBe("/repo/.worktrees/test");
});
```

**When to use:** Testing `tool.execute.before`, `shell.env`, `event` hooks.

### 4. Tool Integration Tests (with Mocks)

Test tool execution with mocked SDK:

```typescript
import { expect, test } from "bun:test";
import { createMockPluginInput } from "./helpers";

test("spawnWorktrees creates sessions", async () => {
  const mockCtx = createMockPluginInput({
    session: { id: "parent-session" }
  });

  // Call tool function
  const result = await spawnWorktrees(mockCtx, "parent-session", {
    tasks: ["task-1"],
    prefix: "feat/",
  });

  expect(result.ok).toBe(true);
  expect(mockCtx.client.session.create).toHaveBeenCalled();
});
```

**When to use:** Tools that interact with OpenCode SDK (session.create, promptAsync, etc.).

### 5. E2E Tests

Test CLI commands by spawning actual processes:

```typescript
import { expect, test } from "bun:test";

const runCli = async (args: string[], cwd: string) => {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
};

test("CLI add command works", async () => {
  const cliPath = path.join(process.cwd(), "src", "cli.ts");
  const result = await runCli([cliPath, "add"], process.cwd());
  expect(result.exitCode).toBe(0);
});
```

**When to use:** CLI commands, testing user-facing behavior.

## Mock Helpers

Use `tests/helpers.ts` for creating mock contexts:

```typescript
import { createMockPluginInput, createMockClient } from "./helpers";

// Create mock plugin context
const ctx = createMockPluginInput({
  worktree: "/custom/path",
});

// Create mock client with custom session behavior
const client = createMockClient({
  create: mock().mockResolvedValue({ data: { id: "custom-id" } }),
});
```

## Testing New Tools

When adding new tools (worktree_message, worktree_notify, worktree_abort, worktree_current):

1. **Unit test pure functions** - Test any helper functions first
2. **Integration test with mocks** - Test tool execution with mocked SDK
3. **Test error cases** - Verify error handling and messages
4. **Test edge cases** - Empty inputs, missing fields, invalid IDs

Example template for new tool:

```typescript
// tests/worktree-message.test.ts
import { expect, test } from "bun:test";
import { createMockPluginInput } from "./helpers";
import { messageWorktreeSession } from "../src/worktree-message";

test("messageWorktreeSession sends prompt to session", async () => {
  const ctx = createMockPluginInput();
  
  const result = await messageWorktreeSession(ctx, {
    sessionID: "sess-1",
    message: "Continue from error",
  });
  
  expect(result.ok).toBe(true);
  expect(ctx.client.session.promptAsync).toHaveBeenCalled();
});

test("messageWorktreeSession fails with invalid sessionID", async () => {
  const ctx = createMockPluginInput();
  
  const result = await messageWorktreeSession(ctx, {
    sessionID: "",
    message: "test",
  });
  
  expect(result.ok).toBe(false);
});
```

## Testing Detection/Monitoring

For SSE monitoring features (Phase 8):

1. **Test detection heuristics** - Pure functions that analyze events
2. **Test metric tracking** - Verify counters and thresholds
3. **Test notification format** - Verify coordinator message formatting
4. **Mock SSE stream** - Use generators or arrays to simulate events

```typescript
test("detectMalformedTool identifies degradation", () => {
  const event = {
    type: "message.part.updated",
    properties: {
      part: { type: "tool", tool: "tool" } // Malformed
    }
  };
  
  const metrics = { malformedTools: 0 };
  if (event.properties.part.tool === "tool") {
    metrics.malformedTools++;
  }
  
  expect(metrics.malformedTools).toBe(1);
});
```

## Best Practices

1. **Clean up state** - Always restore environment variables and remove temp dirs
2. **Test error paths** - Don't only test happy paths
3. **Use descriptive names** - Test names should describe what they test
4. **Keep tests isolated** - Each test should be independent
5. **Mock external dependencies** - Don't rely on real OpenCode instance
6. **Document complex logic** - Add comments for non-obvious test scenarios

## Common Test Scenarios

### Testing with parentSessionID and task fields

```typescript
test("spawn stores parentSessionID", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/test",
    branch: "test",
    sessionID: "sess-child",
    parentSessionID: "sess-parent",  // NEW FIELD
    task: "implement-auth",          // NEW FIELD
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry("sess-child");
  expect(entry?.parentSessionID).toBe("sess-parent");
  expect(entry?.task).toBe("implement-auth");
});
```

### Testing session.create vs session.fork

```typescript
test("startWorktreeSession uses session.create", async () => {
  const ctx = createMockPluginInput();
  
  await startWorktreeSession(ctx, { name: "test" });
  
  // Verify session.create was called (not fork)
  expect(ctx.client.session.create).toHaveBeenCalled();
  expect(ctx.client.session.create.mock.calls[0][0]).toMatchObject({
    query: { directory: expect.any(String) }
  });
});
```

### Testing async prompt delivery

```typescript
test("spawn sends prompt asynchronously", async () => {
  const ctx = createMockPluginInput();
  
  const result = await spawnWorktrees(ctx, "parent", {
    tasks: ["task-1"],
    prompt: "Task: {{task}}",
  });
  
  // Verify promptAsync called with substituted prompt
  expect(ctx.client.session.promptAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        parts: [{ type: "text", text: "Task: task-1" }]
      }
    })
  );
});
```

## Test Coverage Goals

- **Pure functions**: 100% coverage
- **State operations**: All success and error paths
- **Tools**: Main functionality + error cases
- **Hooks**: All conditional branches
- **E2E**: Critical user workflows

Run coverage check:

```bash
bun test --coverage
```