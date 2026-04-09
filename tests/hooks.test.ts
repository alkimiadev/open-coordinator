import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { findSessionEntry, storeSessionMapping, readState } from "../src/state";

const originalXdg = process.env.XDG_CONFIG_HOME;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "open-coordinator-hooks-"));
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

test("findSessionEntry returns null when state is empty", async () => {
  const entry = await findSessionEntry("sess-1");
  expect(entry).toBe(null);
});

test("findSessionEntry returns mapped entry", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/feature",
    branch: "feature",
    sessionID: "sess-1",
    parentSessionID: "sess-parent",
    task: "auth-setup",
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry("sess-1");
  expect(entry).not.toBe(null);
  if (!entry) return;
  expect(entry.sessionID).toBe("sess-1");
  expect(entry.branch).toBe("feature");
  expect(entry.worktreePath).toBe("/repo/.worktrees/feature");
  expect(entry.parentSessionID).toBe("sess-parent");
  expect(entry.task).toBe("auth-setup");
});

test("findSessionEntry returns null for unmapped session", async () => {
  const entry = await findSessionEntry("sess-unmapped");
  expect(entry).toBe(null);
});

test("tool.execute.before hook behavior - simulated", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/hook-test",
    branch: "hook-test",
    sessionID: "sess-hook",
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry("sess-hook");
  expect(entry).not.toBe(null);
  if (!entry) return;
  expect(entry.worktreePath).toBe("/repo/.worktrees/hook-test");
});

test("shell.env hook behavior - simulated", async () => {
  const worktreePath = "/repo/.worktrees/env-test";
  const branch = "env-test";
  const sessionID = "sess-env";

  await storeSessionMapping({
    worktreePath,
    branch,
    sessionID,
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry(sessionID);
  expect(entry).not.toBe(null);
  if (!entry) return;

  const env = {
    OPENCODE_WORKTREE_PATH: entry.worktreePath,
    OPENCODE_WORKTREE_BRANCH: entry.branch,
  };

  expect(env.OPENCODE_WORKTREE_PATH).toBe(worktreePath);
  expect(env.OPENCODE_WORKTREE_BRANCH).toBe(branch);
});

test("state entries include optional parentSessionID and task", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/full-entry",
    branch: "full-entry",
    sessionID: "sess-full",
    parentSessionID: "sess-coordinator",
    task: "implement-auth",
    createdAt: new Date().toISOString(),
  });

  const stateResult = await readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const fullEntry = stateResult.state.entries.find((e) => e.sessionID === "sess-full");
  expect(fullEntry).not.toBe(undefined);
  if (!fullEntry) return;

  expect(fullEntry.parentSessionID).toBe("sess-coordinator");
  expect(fullEntry.task).toBe("implement-auth");
});
