import { expect, test } from "bun:test";

import { parseWorktreeList } from "../src/git";

test("parseWorktreeList parses porcelain output", () => {
  const output = [
    "worktree /repo",
    "HEAD abcdef1",
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/feature",
    "HEAD 1234567",
    "branch refs/heads/feature",
    "prunable worktree prune reason",
    "",
  ].join("\n");

  const worktrees = parseWorktreeList(output);
  expect(worktrees.length).toBe(2);
  expect(worktrees[0]?.path).toBe("/repo");
  expect(worktrees[0]?.branch).toBe("main");
  expect(worktrees[1]?.path).toBe("/repo/.worktrees/feature");
  expect(worktrees[1]?.branch).toBe("feature");
  expect(worktrees[1]?.prunable).toBe(true);
});
