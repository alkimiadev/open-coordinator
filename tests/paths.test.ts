import { expect, test } from "bun:test";
import path from "node:path";

import { getWorktreeRoot, normalizeBranchName, resolveWorktreePath } from "../src/paths";

test("getWorktreeRoot uses .worktrees under repo", () => {
  const repoRoot = path.join("/tmp", "repo");
  expect(getWorktreeRoot(repoRoot)).toBe(path.join(repoRoot, ".worktrees"));
});

test("normalizeBranchName produces git-safe names", () => {
  expect(normalizeBranchName("Feature Audit")).toBe("feature-audit");
  expect(normalizeBranchName("__Weird__Name__")).toBe("weird-name");
});

test("resolveWorktreePath resolves relative paths under .worktrees", () => {
  const repoRoot = path.join("/tmp", "repo");
  const result = resolveWorktreePath(repoRoot, "feature-a");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.path).toBe(path.join(repoRoot, ".worktrees", "feature-a"));
});

test("resolveWorktreePath blocks traversal outside worktree root", () => {
  const repoRoot = path.join("/tmp", "repo");
  const result = resolveWorktreePath(repoRoot, "../escape");
  expect(result.ok).toBe(false);
});

test("resolveWorktreePath allows absolute paths", () => {
  const result = resolveWorktreePath("/tmp/repo", "/var/tmp/worktree");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.path).toBe(path.normalize("/var/tmp/worktree"));
});
