import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { formatError } from "./format";
import type { WorktreeInfo } from "./git";
import { pathsEqual, resolveWorktreePath } from "./paths";

export const headShort = (head: string) => (head ? head.slice(0, 7) : "-");

export const branchLabel = (worktree: WorktreeInfo) =>
  worktree.branch ?? (worktree.detached ? "(detached)" : "-");

export const pathExists = async (target: string) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

export const ensureEmptyDirectory = async (target: string) => {
  try {
    const stats = await stat(target);
    if (!stats.isDirectory()) {
      return {
        ok: false as const,
        error: formatError("Path exists and is not a directory.", {
          hint: `Choose a new path or remove ${target}.`,
        }),
      };
    }
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (errorCode === "ENOENT") {
      return { ok: true as const };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: formatError("Unable to inspect worktree path.", {
        details: message,
      }),
    };
  }

  try {
    const entries = await readdir(target);
    if (entries.length > 0) {
      return {
        ok: false as const,
        error: formatError("Path exists and is not empty.", {
          hint: `Choose an empty directory or remove ${target}.`,
        }),
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: formatError("Unable to inspect worktree contents.", {
        details: message,
      }),
    };
  }

  return { ok: true as const };
};

export const findWorktreeMatch = (worktrees: WorktreeInfo[], repoRoot: string, input: string) => {
  const trimmed = input.trim();
  const resolvedResult = resolveWorktreePath(repoRoot, trimmed);
  if (!resolvedResult.ok) return resolvedResult;

  const normalizedInput = path.normalize(trimmed);
  const resolvedPath = resolvedResult.path;

  const matches = worktrees.filter((worktree) => {
    if (pathsEqual(worktree.path, resolvedPath)) return true;
    if (path.isAbsolute(normalizedInput) && pathsEqual(worktree.path, normalizedInput)) return true;
    if (worktree.branch && worktree.branch === trimmed) return true;
    if (worktree.branch && `refs/heads/${worktree.branch}` === trimmed) return true;
    return false;
  });

  return { ok: true as const, matches };
};
