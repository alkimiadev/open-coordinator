import { mkdir } from "node:fs/promises";

import type { PluginInput } from "@opencode-ai/plugin";

import { formatCommand, formatError, renderTable } from "./format";
import { formatGitFailure, getRepoRoot, getWorktrees, runGit } from "./git";
import { defaultWorktreePath, normalizeBranchName, resolveWorktreePath } from "./paths";
import { err, ok, type ToolResult } from "./result";
import { summarizePorcelain } from "./status";
import {
  branchLabel,
  ensureEmptyDirectory,
  findWorktreeMatch,
  headShort,
  pathExists,
} from "./worktree-helpers";

export { statusWorktrees } from "./worktree-status";

const prepareWorktreeDirectory = async (worktreePath: string) => {
  try {
    await mkdir(worktreePath, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: formatError("Unable to prepare worktree directory.", {
        details: message,
      }),
    };
  }

  const emptyCheck = await ensureEmptyDirectory(worktreePath);
  if (!emptyCheck.ok) return { ok: false as const, error: emptyCheck.error };

  return { ok: true as const };
};

export const listWorktrees = async (ctx: PluginInput): Promise<ToolResult> => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const worktreesResult = await getWorktrees(ctx, repoRoot.path);
  if (!worktreesResult.ok) return err(worktreesResult.error);

  const rows = worktreesResult.worktrees.map((worktree) => [
    branchLabel(worktree),
    worktree.path,
    headShort(worktree.head),
    worktree.locked ? "yes" : "no",
    worktree.prunable ? "yes" : "no",
  ]);

  const table = renderTable(
    ["branch", "path", "head", "locked", "prunable"],
    rows.length > 0 ? rows : [["-", "-", "-", "-", "-"]],
  );

  const command = formatCommand(["git", "worktree", "list", "--porcelain"]);

  return ok(`Worktrees (${worktreesResult.worktrees.length}):\n${table}\nCommand: ${command}`);
};

export type WorktreeCreateDetails = {
  branch: string;
  worktreePath: string;
  base: string;
  command: string;
  branchExists: boolean;
};

export const createWorktreeDetails = async (
  ctx: PluginInput,
  options: { name?: string; branch?: string; base?: string; path?: string },
) => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return { ok: false as const, error: repoRoot.error };

  const name = options.name?.trim() ?? "";
  const branchInput = options.branch?.trim();
  if (!name && !branchInput) {
    return {
      ok: false as const,
      error: formatError("Name or branch is required.", {
        hint: "Provide a logical name to derive the branch or an explicit branch.",
      }),
    };
  }

  const branch = branchInput || normalizeBranchName(name);
  if (!branch) {
    return {
      ok: false as const,
      error: formatError("Unable to derive a valid branch name.", {
        hint: "Provide an explicit branch name.",
      }),
    };
  }

  const branchCheck = await runGit(ctx, ["check-ref-format", "--branch", branch], {
    cwd: repoRoot.path,
  });

  if (!branchCheck.ok) {
    return {
      ok: false as const,
      error: formatGitFailure(branchCheck, "Choose a different branch name."),
    };
  }

  const base = options.base?.trim() || "HEAD";
  const pathResult = options.path
    ? resolveWorktreePath(repoRoot.path, options.path)
    : { ok: true as const, path: defaultWorktreePath(repoRoot.path, branch) };
  if (!pathResult.ok) {
    return { ok: false as const, error: pathResult.error };
  }
  const worktreePath = pathResult.path;

  const prepareResult = await prepareWorktreeDirectory(worktreePath);
  if (!prepareResult.ok) return prepareResult;

  const branchExists = await runGit(
    ctx,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: repoRoot.path },
  );

  if (!branchExists.ok && branchExists.exitCode > 1) {
    return { ok: false as const, error: formatGitFailure(branchExists) };
  }

  const args = branchExists.ok
    ? ["worktree", "add", worktreePath, branch]
    : ["worktree", "add", "-b", branch, worktreePath, base];
  const command = formatCommand(["git", ...args]);

  const addResult = await runGit(ctx, args, { cwd: repoRoot.path });
  if (!addResult.ok) {
    return { ok: false as const, error: formatGitFailure(addResult) };
  }

  return {
    ok: true as const,
    result: {
      branch,
      worktreePath,
      base,
      command,
      branchExists: branchExists.ok,
    },
  };
};

export const createWorktree = async (
  ctx: PluginInput,
  options: { name?: string; branch?: string; base?: string; path?: string },
): Promise<ToolResult> => {
  const result = await createWorktreeDetails(ctx, options);
  if (!result.ok) return err(result.error);

  const lines = [
    "Worktree created.",
    `Branch: ${result.result.branch}`,
    `Path: ${result.result.worktreePath}`,
    `Command: ${result.result.command}`,
  ];

  if (!result.result.branchExists) {
    lines.push(`Base: ${result.result.base}`);
  } else if (options.base) {
    lines.push("Note: Base ignored because the branch already exists.");
  }

  return ok(lines.join("\n"));
};

export type RemoveWorktreeResult = {
  branch: string | null;
  path: string;
  branchDeleted: boolean;
};

export const removeWorktree = async (
  ctx: PluginInput,
  options: { pathOrBranch: string; force?: boolean; remote?: boolean },
): Promise<ToolResult> => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const worktreesResult = await getWorktrees(ctx, repoRoot.path);
  if (!worktreesResult.ok) return err(worktreesResult.error);

  const input = options.pathOrBranch.trim();
  if (!input) {
    return err(
      formatError("pathOrBranch is required.", {
        hint: "Provide a worktree path or branch name.",
      }),
    );
  }

  const matchResult = findWorktreeMatch(worktreesResult.worktrees, repoRoot.path, input);
  if (!matchResult.ok) return err(matchResult.error);

  if (matchResult.matches.length === 0) {
    return err(
      formatError("No worktree matches the provided value.", {
        hint: 'Use worktree({action: "list"}) to see available worktrees.',
      }),
    );
  }

  if (matchResult.matches.length > 1) {
    return err(
      formatError("Multiple worktrees match the provided value.", {
        details: matchResult.matches.map((match) => match.path).join(", "),
      }),
    );
  }

  const target = matchResult.matches[0];

  if (!(await pathExists(target.path))) {
    return err(
      formatError("Worktree path does not exist.", {
        hint: 'If it was deleted manually, run worktree({action: "cleanup", args: {action: "prune"}}) instead.',
      }),
    );
  }

  if (!options.force) {
    const statusResult = await runGit(ctx, ["status", "--porcelain"], {
      cwd: target.path,
    });

    if (!statusResult.ok) {
      return err(formatGitFailure(statusResult, "Unable to check worktree status."));
    }

    const summary = summarizePorcelain(statusResult.stdout);
    if (!summary.clean) {
      return err(
        formatError("Worktree has uncommitted changes.", {
          hint: "Re-run with force: true to remove anyway.",
        }),
      );
    }
  }

  const args = options.force
    ? ["worktree", "remove", "--force", target.path]
    : ["worktree", "remove", target.path];
  const command = formatCommand(["git", ...args]);

  const removeResult = await runGit(ctx, args, { cwd: repoRoot.path });
  if (!removeResult.ok) return err(formatGitFailure(removeResult));

  let branchDeleted = false;
  const branchName = target.branch;
  if (branchName) {
    const branchArgs = options.force ? ["branch", "-D", branchName] : ["branch", "-d", branchName];
    const branchResult = await runGit(ctx, branchArgs, { cwd: repoRoot.path });
    branchDeleted = branchResult.ok;
  }

  let remoteResult: ToolResult | null = null;
  if (options.remote && branchName) {
    remoteResult = await deleteRemoteBranch(ctx, branchName);
  }

  const lines = [
    "Worktree removed.",
    `Branch: ${branchLabel(target)}`,
    `Path: ${target.path}`,
    `Command: ${command}`,
  ];

  if (branchName && branchDeleted) {
    lines.push(`Branch ${branchName} deleted.`);
  } else if (branchName && !branchDeleted) {
    lines.push(`Warning: Branch ${branchName} could not be deleted. Remove it manually if needed.`);
  }

  if (remoteResult) {
    lines.push(remoteResult.ok ? remoteResult.output : `Warning: ${remoteResult.error}`);
  }

  if (options.force) {
    lines.push("Note: Removed with --force.");
  }

  return ok(lines.join("\n"));
};

export const pruneWorktrees = async (
  ctx: PluginInput,
  options: { dryRun?: boolean },
): Promise<ToolResult> => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const args = options.dryRun ? ["worktree", "prune", "--dry-run"] : ["worktree", "prune"];
  const command = formatCommand(["git", ...args]);

  const pruneResult = await runGit(ctx, args, { cwd: repoRoot.path });
  if (!pruneResult.ok) return err(formatGitFailure(pruneResult));

  const output = pruneResult.stdout.trim();
  const lines = [
    "Worktree prune complete.",
    `Command: ${command}`,
    output ? `Output: ${output}` : "Output: (none)",
  ];

  return ok(lines.join("\n"));
};

export const deleteRemoteBranch = async (ctx: PluginInput, branch: string): Promise<ToolResult> => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const remoteResult = await runGit(ctx, ["remote"], { cwd: repoRoot.path });
  if (!remoteResult.ok) return err(formatGitFailure(remoteResult));
  const remotes = remoteResult.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (remotes.length === 0) {
    return ok("No remotes configured. Skipping remote branch deletion.");
  }

  const lines: string[] = [];
  for (const remote of remotes) {
    const pushResult = await runGit(ctx, ["push", remote, "--delete", branch], {
      cwd: repoRoot.path,
    });
    if (pushResult.ok) {
      lines.push(`Remote branch ${branch} deleted from ${remote}.`);
    } else {
      const stderr = pushResult.stderr.trim();
      if (
        stderr.toLowerCase().includes("not found") ||
        stderr.toLowerCase().includes("does not exist") ||
        stderr.toLowerCase().includes("remote ref") ||
        pushResult.exitCode === 1
      ) {
        lines.push(`Remote branch ${branch} not found on ${remote} (may already be deleted).`);
      } else {
        lines.push(`Warning: Could not delete remote branch ${branch} from ${remote}: ${stderr}`);
      }
    }
  }

  return ok(lines.join("\n"));
};

export const listMergedBranches = async (
  ctx: PluginInput,
  options: { prefix?: string; remote?: boolean },
): Promise<ToolResult> => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const prefix = options.prefix ?? "wt/";

  const mergedResult = await runGit(ctx, ["branch", "--merged", "HEAD"], { cwd: repoRoot.path });
  if (!mergedResult.ok) return err(formatGitFailure(mergedResult));

  const allMerged = mergedResult.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith(prefix));

  const lines: string[] = [`Merged branches matching prefix '${prefix}':`];
  if (allMerged.length === 0) {
    lines.push("(none)");
  } else {
    for (const branch of allMerged) {
      lines.push(`  ${branch}`);
    }
  }

  return ok(lines.join("\n"));
};

export const mergeWorktreeBranch = async (
  ctx: PluginInput,
  options: { branch: string; target?: string; deleteBranch?: boolean; remote?: boolean },
): Promise<ToolResult> => {
  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const branch = options.branch.trim();
  if (!branch) {
    return err(formatError("branch is required.", { hint: "Provide the branch name to merge." }));
  }

  const target = options.target?.trim() || "main";

  const branchCheck = await runGit(
    ctx,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: repoRoot.path },
  );
  if (!branchCheck.ok) {
    return err(
      formatError(`Branch '${branch}' does not exist locally.`, {
        hint: "Check the branch name with git branch.",
      }),
    );
  }

  const targetCheck = await runGit(
    ctx,
    ["show-ref", "--verify", "--quiet", `refs/heads/${target}`],
    { cwd: repoRoot.path },
  );
  if (!targetCheck.ok) {
    return err(
      formatError(`Target branch '${target}' does not exist locally.`, {
        hint: `Create it first or use a different target branch.`,
      }),
    );
  }

  const lines: string[] = [];
  let stashed = false;

  const statusResult = await runGit(ctx, ["status", "--porcelain"], { cwd: repoRoot.path });
  if (statusResult.ok) {
    const summary = summarizePorcelain(statusResult.stdout);
    if (!summary.clean) {
      lines.push("Working directory has uncommitted changes. Stashing...");
      const stashResult = await runGit(ctx, ["stash", "--include-untracked"], {
        cwd: repoRoot.path,
      });
      if (!stashResult.ok) {
        return err(
          formatGitFailure(stashResult, "Stash failed. Resolve uncommitted changes manually."),
        );
      }
      stashed = true;
      lines.push("Stashed successfully.");
    }
  }

  const checkoutResult = await runGit(ctx, ["checkout", target], { cwd: repoRoot.path });
  if (!checkoutResult.ok) {
    if (stashed) {
      await runGit(ctx, ["stash", "pop"], { cwd: repoRoot.path });
    }
    return err(formatGitFailure(checkoutResult, `Could not checkout target branch '${target}'.`));
  }
  lines.push(`Checked out '${target}'.`);

  const mergeResult = await runGit(ctx, ["merge", branch], { cwd: repoRoot.path });
  if (!mergeResult.ok) {
    lines.push(`Merge of '${branch}' into '${target}' failed.`);
    lines.push(mergeResult.stderr.trim() || mergeResult.stdout.trim());
    if (stashed) {
      lines.push("Warning: Stashed changes were not restored due to merge conflict.");
    }
    return ok(lines.join("\n"));
  }
  lines.push(`Merged '${branch}' into '${target}'.`);

  if (stashed) {
    const popResult = await runGit(ctx, ["stash", "pop"], { cwd: repoRoot.path });
    if (popResult.ok) {
      lines.push("Stash restored.");
    } else {
      lines.push(`Warning: Could not restore stash: ${popResult.stderr.trim()}`);
    }
  }

  if (options.deleteBranch !== false) {
    const branchDeleteResult = await runGit(ctx, ["branch", "-d", branch], { cwd: repoRoot.path });
    if (branchDeleteResult.ok) {
      lines.push(`Local branch '${branch}' deleted.`);
    } else {
      lines.push(
        `Warning: Could not delete local branch '${branch}': ${branchDeleteResult.stderr.trim()}`,
      );
    }
  }

  if (options.remote) {
    const remoteResult = await deleteRemoteBranch(ctx, branch);
    lines.push(remoteResult.ok ? remoteResult.output : `Warning: ${remoteResult.error}`);
  }

  return ok(lines.join("\n"));
};
