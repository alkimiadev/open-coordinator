import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectRole, getAvailableOps, isOpAllowed, route } from "../src/registry";
import { findSessionEntry, storeSessionMapping } from "../src/state";
import { createMockPluginInput } from "./helpers";

let tempDir: string;
const originalXdg = process.env.XDG_CONFIG_HOME;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "open-coordinator-registry-"));
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

test("detectRole returns coordinator for unmapped session", async () => {
  const role = await detectRole("sess-unmapped-" + Date.now());
  expect(role).toBe("coordinator");
});

test("detectRole returns coordinator when sessionID is undefined", async () => {
  const role = await detectRole(undefined);
  expect(role).toBe("coordinator");
});

test("detectRole returns implementation for session with parentSessionID", async () => {
  const sessionID = `sess-impl-${Date.now()}`;
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/impl-test",
    branch: "impl-test",
    sessionID,
    parentSessionID: "sess-coordinator",
    task: "test-impl",
    createdAt: new Date().toISOString(),
  });

  const role = await detectRole(sessionID);
  expect(role).toBe("implementation");
});

test("detectRole returns coordinator for session without parentSessionID", async () => {
  const sessionID = `sess-coord-${Date.now()}`;
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/coord-test",
    branch: "coord-test",
    sessionID,
    createdAt: new Date().toISOString(),
  });

  const role = await detectRole(sessionID);
  expect(role).toBe("coordinator");
});

test("isOpAllowed: coordinator can access all operations", () => {
  for (const op of [
    "help",
    "list",
    "status",
    "dashboard",
    "create",
    "start",
    "open",
    "fork",
    "swarm",
    "spawn",
    "message",
    "notify",
    "sessions",
    "abort",
    "cleanup",
    "merge",
    "current",
  ]) {
    expect(isOpAllowed(op, "coordinator")).toBe(true);
  }
});

test("isOpAllowed: implementation can only access allowed operations", () => {
  const allowed = ["help", "current", "notify", "status"];
  for (const op of allowed) {
    expect(isOpAllowed(op, "implementation")).toBe(true);
  }

  const forbidden = [
    "list",
    "dashboard",
    "create",
    "start",
    "open",
    "fork",
    "swarm",
    "spawn",
    "message",
    "sessions",
    "abort",
    "cleanup",
    "merge",
  ];
  for (const op of forbidden) {
    expect(isOpAllowed(op, "implementation")).toBe(false);
  }
});

test("getAvailableOps returns sorted operations for coordinator", () => {
  const ops = getAvailableOps("coordinator");
  expect(ops).toContain("create");
  expect(ops).toContain("spawn");
  expect(ops).toContain("cleanup");
  expect(ops.length).toBe(17);
});

test("getAvailableOps returns limited operations for implementation", () => {
  const ops = getAvailableOps("implementation");
  expect(ops).toEqual(["current", "help", "notify", "status"]);
});

test("route returns help text for help action", async () => {
  const ctx = createMockPluginInput();
  const result = await route("help", {}, { ctx, sessionID: "test", role: "coordinator" });
  expect(result).toContain("Worktree Coordinator");
  expect(result).toContain("worktree({action:");
});

test("route returns specific help for a known operation", async () => {
  const ctx = createMockPluginInput();
  const result = await route(
    "help",
    { action: "spawn" },
    { ctx, sessionID: "test", role: "coordinator" },
  );
  expect(result).toContain("**spawn**");
});

test("route returns unknown operation message for invalid action", async () => {
  const ctx = createMockPluginInput();
  const result = await route("nonexistent", {}, { ctx, sessionID: "test", role: "coordinator" });
  expect(result).toContain("Unknown operation");
  expect(result).toContain("nonexistent");
});

test("route blocks implementation role from coordinator operations", async () => {
  const ctx = createMockPluginInput();
  const result = await route(
    "create",
    { name: "test-branch" },
    { ctx, sessionID: "test", role: "implementation" },
  );
  expect(result).toContain("not available for implementation sessions");
  expect(result).toContain("create");
});

test("route allows implementation role to use current", async () => {
  const sessionID = `sess-current-registry-${Date.now()}`;
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/current-reg-test",
    branch: "current-reg-test",
    sessionID,
    parentSessionID: "sess-coordinator",
    task: "test-current",
    createdAt: new Date().toISOString(),
  });

  const ctx = createMockPluginInput();
  const result = await route("current", {}, { ctx, sessionID, role: "implementation" });
  expect(result).toContain(sessionID);
  expect(result).toContain("current-reg-test");
});

test("route allows implementation role to use notify", async () => {
  const sessionID = `sess-notify-reg-${Date.now()}`;
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/notify-reg-test",
    branch: "notify-reg-test",
    sessionID,
    parentSessionID: "sess-coordinator-reg",
    task: "test-notify",
    createdAt: new Date().toISOString(),
  });

  const ctx = createMockPluginInput();
  const result = await route(
    "notify",
    { message: "Hello" },
    { ctx, sessionID, role: "implementation" },
  );
  expect(result).toContain("Notified coordinator");
  expect(ctx.client.session.promptAsync).toHaveBeenCalled();
});

test("route handles sessions query", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/sessions-reg-test",
    branch: "sessions-reg-test",
    sessionID: `sess-sessions-reg-${Date.now()}`,
    task: "test-sessions",
    createdAt: new Date().toISOString(),
  });

  const ctx = createMockPluginInput();
  const result = await route("sessions", {}, { ctx, sessionID: "test", role: "coordinator" });
  expect(result).toContain("sessionID");
  expect(result).toContain("branch");
});

test("route handles abort", async () => {
  const ctx = createMockPluginInput();
  const result = await route(
    "abort",
    { sessionID: "sess-to-abort" },
    { ctx, sessionID: "test", role: "coordinator" },
  );
  expect(result).toContain("aborted");
  expect(ctx.client.session.abort).toHaveBeenCalled();
});

test("route returns error for notify without parent session", async () => {
  const ctx = createMockPluginInput();
  const result = await route(
    "notify",
    { message: "Hello" },
    { ctx, sessionID: "unmapped-session", role: "implementation" },
  );
  expect(result).toContain("No coordinator session found");
});

test("route returns error for cleanup without action", async () => {
  const ctx = createMockPluginInput();
  const result = await route("cleanup", {}, { ctx, sessionID: "test", role: "coordinator" });
  expect(result).toContain("action must be");
});
