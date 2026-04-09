import path from "node:path";

import { formatError } from "./format";

export const normalizeBranchName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const normalized = trimmed
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9./-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+/, "")
    .replace(/[-/]+$/, "");

  return normalized;
};

export const getWorktreeRoot = (repoRoot: string) => path.join(repoRoot, ".worktrees");

export const defaultWorktreePath = (repoRoot: string, branch: string) =>
  path.join(getWorktreeRoot(repoRoot), branch);

const isWithinRoot = (root: string, target: string) => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(rootPrefix);
};

export const resolveWorktreePath = (repoRoot: string, inputPath: string) => {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return {
      ok: false as const,
      error: formatError("Worktree path is required."),
    };
  }

  if (path.isAbsolute(trimmed)) {
    return { ok: true as const, path: path.normalize(trimmed) };
  }

  const root = getWorktreeRoot(repoRoot);
  const resolved = path.resolve(root, trimmed);
  if (!isWithinRoot(root, resolved)) {
    return {
      ok: false as const,
      error: formatError("Worktree path must stay within the worktree root.", {
        hint: `Use a path under ${root}.`,
      }),
    };
  }

  return { ok: true as const, path: resolved };
};

export const pathsEqual = (left: string, right: string) =>
  path.resolve(left) === path.resolve(right);
