import { expect, test, beforeAll, afterAll } from "bun:test";
import { mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMockPluginInput } from "./helpers";
import { storeSessionMapping, findSessionEntry } from "../src/state";
import type { ToolDefinition } from "@opencode-ai/plugin";

const originalXdg = process.env.XDG_CONFIG_HOME;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "open-coordinator-session-tools-"));
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

test("worktree_message sends prompt to spawned session", async () => {
  const mockCtx = createMockPluginInput();
  const mockPromptAsync = mockCtx.client.session.promptAsync;

  const sessionId = "sess-child-1";
  const message = "Please continue from where you left off";
  const agent = "implementation-specialist";

  mockPromptAsync.mockResolvedValue({ data: {} });

  const result = await mockCtx.client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: message }],
      agent,
    },
  });

  expect(mockPromptAsync).toHaveBeenCalled();
  expect(mockPromptAsync.mock.calls[0][0]).toMatchObject({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: message }],
      agent,
    },
  });
});

test("worktree_message works without agent parameter", async () => {
  const mockCtx = createMockPluginInput();
  const mockPromptAsync = mockCtx.client.session.promptAsync;

  const sessionId = "sess-child-2";
  const message = "Recovery message";

  mockPromptAsync.mockResolvedValue({ data: {} });

  const result = await mockCtx.client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: message }],
    },
  });

  expect(mockPromptAsync).toHaveBeenCalled();
  expect(mockPromptAsync.mock.calls[0][0].body.parts[0].text).toBe(message);
  expect(mockPromptAsync.mock.calls[0][0].body.agent).toBeUndefined();
});

test("worktree_notify requires parentSessionID in state", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/notify-test",
    branch: "notify-test",
    sessionID: "sess-notify",
    parentSessionID: "sess-coordinator",
    task: "test-notify",
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry("sess-notify");
  expect(entry).not.toBe(null);
  if (!entry) return;

  expect(entry.parentSessionID).toBe("sess-coordinator");
  expect(entry.task).toBe("test-notify");
});

test("worktree_notify returns error without parentSessionID", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/no-parent",
    branch: "no-parent",
    sessionID: "sess-no-parent",
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry("sess-no-parent");
  expect(entry).not.toBe(null);
  if (!entry) return;

  expect(entry.parentSessionID).toBeUndefined();
});

test("worktree_notify formats info level message", async () => {
  const mockCtx = createMockPluginInput();
  const mockPromptAsync = mockCtx.client.session.promptAsync;

  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/info-test",
    branch: "info-test",
    sessionID: "sess-info",
    parentSessionID: "sess-coord-info",
    task: "info-task",
    createdAt: new Date().toISOString(),
  });

  mockPromptAsync.mockResolvedValue({ data: {} });

  const entry = await findSessionEntry("sess-info");
  if (!entry?.parentSessionID) return;

  const message = "Task completed successfully";
  const level = "info";
  const levelPrefix = level === "blocking" ? "⚠️ BLOCKING" : level === "warning" ? "⚠️" : "";
  const taskInfo = entry.task ? ` [${entry.task}]` : ` [${entry.branch}]`;
  const text = [levelPrefix, taskInfo, message].filter(Boolean).join(" ");

  await mockCtx.client.session.promptAsync({
    path: { id: entry.parentSessionID },
    body: {
      parts: [{ type: "text", text }],
    },
  });

  expect(mockPromptAsync).toHaveBeenCalled();
  expect(mockPromptAsync.mock.calls[0][0].body.parts[0].text).toBe(
    " [info-task] Task completed successfully",
  );
});

test("worktree_notify formats blocking level message", async () => {
  const mockCtx = createMockPluginInput();
  const mockPromptAsync = mockCtx.client.session.promptAsync;

  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/blocking-test",
    branch: "blocking-test",
    sessionID: "sess-blocking",
    parentSessionID: "sess-coord-block",
    task: "blocking-task",
    createdAt: new Date().toISOString(),
  });

  mockPromptAsync.mockResolvedValue({ data: {} });

  const entry = await findSessionEntry("sess-blocking");
  if (!entry?.parentSessionID) return;

  const message = "Cannot proceed without dependency";
  const level = "blocking";
  const levelPrefix = "⚠️ BLOCKING";
  const taskInfo = ` [${entry.task}]`;
  const text = `${levelPrefix} ${taskInfo} ${message}`;

  await mockCtx.client.session.promptAsync({
    path: { id: entry.parentSessionID },
    body: {
      parts: [{ type: "text", text }],
    },
  });

  expect(mockPromptAsync).toHaveBeenCalled();
  expect(mockPromptAsync.mock.calls[0][0].body.parts[0].text).toContain("⚠️ BLOCKING");
  expect(mockPromptAsync.mock.calls[0][0].body.parts[0].text).toContain(message);
});

test("worktree_status queries state and formats table", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/status-1",
    branch: "status-1",
    sessionID: "sess-status-1",
    task: "task-1",
    createdAt: new Date().toISOString(),
  });

  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/status-2",
    branch: "status-2",
    sessionID: "sess-status-2",
    task: "task-2",
    createdAt: new Date().toISOString(),
  });

  const stateResult = await (await import("../src/state")).readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const entries = stateResult.state.entries.filter(
    (e) => e.sessionID === "sess-status-1" || e.sessionID === "sess-status-2",
  );

  expect(entries.length).toBe(2);

  const lines: string[] = [];
  lines.push("| sessionID | branch | task | worktreePath |");
  lines.push("|-----------|--------|------|--------------|");
  for (const e of entries) {
    lines.push(`| ${e.sessionID} | ${e.branch} | ${e.task ?? "-"} | ${e.worktreePath} |`);
  }

  const output = lines.join("\n");
  expect(output).toContain("sess-status-1");
  expect(output).toContain("sess-status-2");
  expect(output).toContain("task-1");
  expect(output).toContain("task-2");
});

test("worktree_status filters by sessionIDs", async () => {
  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/filter-1",
    branch: "filter-1",
    sessionID: "sess-filter-1",
    task: "filter-task-1",
    createdAt: new Date().toISOString(),
  });

  await storeSessionMapping({
    worktreePath: "/repo/.worktrees/filter-2",
    branch: "filter-2",
    sessionID: "sess-filter-2",
    task: "filter-task-2",
    createdAt: new Date().toISOString(),
  });

  const stateResult = await (await import("../src/state")).readState();
  expect(stateResult.ok).toBe(true);
  if (!stateResult.ok) return;

  const sessionIDs = ["sess-filter-1"];
  const entries = stateResult.state.entries.filter((e) => sessionIDs.includes(e.sessionID));

  expect(entries.length).toBe(1);
  expect(entries[0]?.sessionID).toBe("sess-filter-1");
});

test("worktree_abort calls session.abort API", async () => {
  const mockCtx = createMockPluginInput();
  const mockAbort = mockCtx.client.session.abort;

  const sessionId = "sess-to-abort";
  mockAbort.mockResolvedValue({ data: {} });

  await mockCtx.client.session.abort({
    path: { id: sessionId },
  });

  expect(mockAbort).toHaveBeenCalled();
  expect(mockAbort.mock.calls[0][0]).toMatchObject({
    path: { id: sessionId },
  });
});

test("worktree_current returns mapping for current session", async () => {
  const sessionID = "sess-current-test";
  const worktreePath = "/repo/.worktrees/current-test";
  const branch = "current-test";
  const task = "current-task";
  const parentSessionID = "sess-coordinator";

  await storeSessionMapping({
    worktreePath,
    branch,
    sessionID,
    parentSessionID,
    task,
    createdAt: new Date().toISOString(),
  });

  const entry = await findSessionEntry(sessionID);
  expect(entry).not.toBe(null);
  if (!entry) return;

  const lines: string[] = [];
  lines.push(`Session: ${entry.sessionID}`);
  lines.push(`Branch: ${entry.branch}`);
  lines.push(`Worktree: ${entry.worktreePath}`);
  if (entry.task) lines.push(`Task: ${entry.task}`);
  if (entry.parentSessionID) lines.push(`Coordinator: ${entry.parentSessionID}`);

  const output = lines.join("\n");
  expect(output).toContain(sessionID);
  expect(output).toContain(branch);
  expect(output).toContain(worktreePath);
  expect(output).toContain(task);
  expect(output).toContain(parentSessionID);
});

test("worktree_current returns error for unmapped session", async () => {
  const entry = await findSessionEntry("sess-unmapped-current");
  expect(entry).toBe(null);
});
