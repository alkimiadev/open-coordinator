import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readState, removeSessionMappings, storeSessionMapping } from "../src/state";

const originalXdg = process.env.XDG_CONFIG_HOME;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "open-coordinator-state-enhanced-"));
  process.env.XDG_CONFIG_HOME = tempDir;
});

afterAll(async () => {
  if (originalXdg === undefined) {
    process.env.XDG_CONFIG_HOME = undefined;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdg;
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("storeSessionMapping accepts parentSessionID and task", async () => {
  const result = await storeSessionMapping({
    worktreePath: "/repo/.worktrees/enhanced",
    branch: "enhanced",
    sessionID: "sess-enhanced",
    parentSessionID: "sess-parent",
    task: "implement-feature",
    createdAt: new Date().toISOString(),
  });

  expect(result.ok).toBe(true);
});

test("readState returns entries with parentSessionID and task", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/read-test",
    branch: "read-test",
    sessionID: "sess-read",
    parentSessionID: "sess-coordinator",
    task: "testing-read",
    createdAt: new Date().toISOString(),
  });

  const stateResult = await readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const entry = stateResult.state.entries.find((e) => e.sessionID === "sess-read");
  expect(entry).not.toBe(undefined);
  if (!entry) return;

  expect(entry.parentSessionID).toBe("sess-coordinator");
  expect(entry.task).toBe("testing-read");
});

test("storeSessionMapping works without optional fields", async () => {
  const result = await storeSessionMapping({
    worktreePath: "/repo/.worktrees/minimal",
    branch: "minimal",
    sessionID: "sess-minimal",
    createdAt: new Date().toISOString(),
  });

  expect(result.ok).toBe(true);

  const stateResult = await readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const entry = stateResult.state.entries.find((e) => e.sessionID === "sess-minimal");
  expect(entry).not.toBe(undefined);
  if (!entry) return;

  expect(entry.parentSessionID).toBe(undefined);
  expect(entry.task).toBe(undefined);
});

test("removeSessionMappings removes entries with enhanced fields", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/remove-test",
    branch: "remove-test",
    sessionID: "sess-remove",
    parentSessionID: "sess-parent",
    task: "removal-test",
    createdAt: new Date().toISOString(),
  });

  const removeResult = await removeSessionMappings("sess-remove");
  expect(removeResult.ok).toBe(true);
  if (!removeResult.ok) return;
  expect(removeResult.removed).toBe(1);

  const stateResult = await readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const entry = stateResult.state.entries.find((e) => e.sessionID === "sess-remove");
  expect(entry).toBe(undefined);
});

test("multiple entries with different parentSessionIDs", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/multi-1",
    branch: "multi-1",
    sessionID: "sess-multi-1",
    parentSessionID: "sess-coord-1",
    task: "task-1",
    createdAt: new Date().toISOString(),
  });

  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/multi-2",
    branch: "multi-2",
    sessionID: "sess-multi-2",
    parentSessionID: "sess-coord-2",
    task: "task-2",
    createdAt: new Date().toISOString(),
  });

  const stateResult = await readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const entry1 = stateResult.state.entries.find((e) => e.sessionID === "sess-multi-1");
  const entry2 = stateResult.state.entries.find((e) => e.sessionID === "sess-multi-2");

  expect(entry1?.parentSessionID).toBe("sess-coord-1");
  expect(entry1?.task).toBe("task-1");
  expect(entry2?.parentSessionID).toBe("sess-coord-2");
  expect(entry2?.task).toBe("task-2");
});
