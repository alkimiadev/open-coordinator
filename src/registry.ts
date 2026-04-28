import type { PluginInput } from "@opencode-ai/plugin";
import { formatError } from "./format";
import { formatGitFailure, getRepoRoot, runGit } from "./git";
import {
  findSessionEntry,
  readState,
  removeSessionMappings,
  removeSessionMappingsByBranch,
  updateSessionStatus,
} from "./state";
import {
  createWorktree,
  deleteRemoteBranch,
  listMergedBranches,
  listWorktrees,
  mergeWorktreeBranch,
  pruneWorktrees,
  removeWorktree,
} from "./worktree";
import { dashboardWorktrees } from "./worktree-dashboard";
import { forkWorktreeSession, openWorktreeSession, startWorktreeSession } from "./worktree-session";
import { spawnWorktrees } from "./worktree-spawn";
import { statusWorktrees } from "./worktree-status";
import { swarmWorktrees } from "./worktree-swarm";

type ToolArgs = Record<string, unknown>;

type HandlerContext = {
  ctx: PluginInput;
  sessionID?: string;
  role: "coordinator" | "implementation";
};

type HandlerResult = string;

type Handler = (args: ToolArgs, hctx: HandlerContext) => Promise<HandlerResult>;

const COORDINATOR_OPS = new Set([
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
  "sessions",
  "abort",
  "cleanup",
  "merge",
  "current",
  "notify",
]);

const IMPLEMENTATION_OPS = new Set(["help", "current", "notify", "status"]);

export const detectRole = async (sessionID?: string): Promise<"coordinator" | "implementation"> => {
  if (!sessionID) return "coordinator";
  const entry = await findSessionEntry(sessionID);
  if (entry?.parentSessionID) return "implementation";
  return "coordinator";
};

const HELP_TEXT = `# Worktree Coordinator

Call \`worktree({action: "<operation>", args: {...}})\` to use one.

Your role determines which operations are available:
- **coordinator**: All operations (sessions not spawned by another session)
- **implementation**: current, notify, help (sessions spawned by a coordinator)

| Operation | Description | Key args |
|-----------|-------------|----------|
| help | Show this reference, or details for a specific operation | action or tool |
| list | List git worktrees | — |
| status | Show worktree status (git status) | path, all, porcelain |
| dashboard | Worktree dashboard with session info | — |
| create | Create a new worktree | name, branch, base, path |
| start | Create worktree + start new session | name, branch, base, path, pathOrBranch, openSessions |
| open | Open existing worktree in a new session | pathOrBranch, path, name, branch, openSessions |
| fork | Create worktree + fork current session context | name, branch, base, path, pathOrBranch, openSessions |
| swarm | Create multiple worktrees + sessions for parallel tasks | tasks, prefix, openSessions, force |
| spawn | Create worktrees + sessions + send async prompts | tasks, prefix, agent, prompt |
| message | Send message to a spawned session | sessionID, message, agent |
| notify | Send message to coordinator session | message, level (info/warning/blocking) |
| sessions | Query status of spawned sessions | sessionIDs (optional filter), status (optional filter) |
| abort | Abort a spawned session | sessionID |
| cleanup | Remove, prune, or clean up merged worktrees | action (remove/prune/merged), pathOrBranch, force, remote, dryRun, prefix |
| merge | Merge a worktree branch into target | branch, target, deleteBranch, remote |
| current | Show current session's worktree mapping | — |

Examples:
- \`worktree({action: "help"})\`
- \`worktree({action: "help", args: {action: "spawn"}})\`
- \`worktree({action: "list"})\`
- \`worktree({action: "create", args: {name: "feature audit"}})\`
- \`worktree({action: "start", args: {name: "feature audit", openSessions: true}})\`
- \`worktree({action: "spawn", args: {tasks: ["auth", "db"], prefix: "feat/"}})\`
- \`worktree({action: "notify", args: {message: "Done!", level: "info"}})\`
- \`worktree({action: "cleanup", args: {action: "prune", dryRun: true}})\`
- \`worktree({action: "cleanup", args: {action: "merged", dryRun: true}})\`
- \`worktree({action: "cleanup", args: {action: "merged", remote: true}})\`
- \`worktree({action: "merge", args: {branch: "wt/feature-auth"}})\`
- \`worktree({action: "merge", args: {branch: "wt/feature-auth", target: "main", remote: true}})\``;

const OP_HELP: Record<string, string> = {
  help: `**help** — Show available operations and usage. Args: action (string, optional operation name for details).`,
  list: `**list** — List all git worktrees. No args needed.`,
  status: `**status** — Show git worktree status. Args: path (string, optional filter), all (boolean), porcelain (boolean).`,
  dashboard: `**dashboard** — Show worktree dashboard with session details. No args needed.`,
  create: `**create** — Create a new git worktree branch and checkout.
Args: name (string, logical name), branch (string, explicit branch name), base (string, base ref, default HEAD), path (string, explicit path).`,
  start: `**start** — Create a worktree and start a fresh session in it.
Args: name, branch, base, path, pathOrBranch, openSessions (boolean).`,
  open: `**open** — Open an existing worktree in a new session.
Args: pathOrBranch, path, name, branch, openSessions (boolean).`,
  fork: `**fork** — Create worktree and fork current session context into it.
Args: name, branch, base, path, pathOrBranch, openSessions (boolean).`,
  swarm: `**swarm** — Create multiple worktrees + sessions for parallel tasks.
Args: tasks (string[], required), prefix (string, default "wt/"), openSessions (boolean), force (boolean).`,
  spawn: `**spawn** — Create worktrees + sessions + send initial prompts asynchronously.
Args: tasks (string[], required), prefix (string, default "wt/"), agent (string), prompt (string, use {{task}} for substitution), model (object: {providerID, modelID}, defaults to coordinator's model).`,
  message: `**message** — Send a message to a spawned session for recovery or check-ins.
Args: sessionID (string, required), message (string, required), agent (string, optional).`,
  notify: `**notify** — Send a message back to the coordinator session. Implementation agents use this to report completion or issues.
Args: message (string, required), level (string: "info" | "warning" | "blocking", default "info").`,
  sessions: `**sessions** — Query status of sessions spawned by this coordinator.
Args: sessionIDs (string[], optional filter to specific sessions), status (string, optional filter: "active" | "completed" | "failed" | "aborted").`,
  abort: `**abort** — Abort a spawned session and clean up its worktree. Removes the worktree, local branch, and state entry.
Args: sessionID (string, required).`,
  cleanup: `**cleanup** — Remove, prune, or clean up merged worktrees. Destructive operation.
Args: action (string: "remove" | "prune" | "merged", required), pathOrBranch (string, required for remove), force (boolean), remote (boolean, also delete remote branches), dryRun (boolean, for prune/merged), prefix (string, for merged, default "wt/").`,
  merge: `**merge** — Merge a worktree branch into a target branch with auto-stash.
Args: branch (string, required — the branch to merge), target (string, default "main" — the branch to merge into), deleteBranch (boolean, default true — delete local branch after merge), remote (boolean — also delete remote branch after merge).`,
  current: `**current** — Show the worktree mapping for the current session. No args needed.`,
};

const handlers: Record<string, Handler> = {
  async help(args) {
    const opName = args.action ?? args.tool;
    if (typeof opName === "string") {
      return (
        OP_HELP[opName] ??
        `Unknown operation: ${opName}. Call worktree({action: "help"}) for the full list.`
      );
    }
    return HELP_TEXT;
  },

  async list(_args, hctx) {
    const result = await listWorktrees(hctx.ctx);
    return result.ok ? result.output : result.error;
  },

  async status(args, hctx) {
    const result = await statusWorktrees(hctx.ctx, {
      path: typeof args.path === "string" ? args.path : undefined,
      all: args.all === true,
      porcelain: args.porcelain === true,
    });
    return result.ok ? result.output : result.error;
  },

  async dashboard(_args, hctx) {
    const result = await dashboardWorktrees(hctx.ctx);
    return result.ok ? result.output : result.error;
  },

  async create(args, hctx) {
    const result = await createWorktree(hctx.ctx, {
      name: typeof args.name === "string" ? args.name : undefined,
      branch: typeof args.branch === "string" ? args.branch : undefined,
      base: typeof args.base === "string" ? args.base : undefined,
      path: typeof args.path === "string" ? args.path : undefined,
    });
    return result.ok ? result.output : result.error;
  },

  async start(args, hctx) {
    const result = await startWorktreeSession(hctx.ctx, {
      name: typeof args.name === "string" ? args.name : undefined,
      branch: typeof args.branch === "string" ? args.branch : undefined,
      base: typeof args.base === "string" ? args.base : undefined,
      path: typeof args.path === "string" ? args.path : undefined,
      pathOrBranch: typeof args.pathOrBranch === "string" ? args.pathOrBranch : undefined,
      openSessions: args.openSessions === true,
    });
    return result.ok ? result.output : result.error;
  },

  async open(args, hctx) {
    const result = await openWorktreeSession(hctx.ctx, {
      name: typeof args.name === "string" ? args.name : undefined,
      branch: typeof args.branch === "string" ? args.branch : undefined,
      base: typeof args.base === "string" ? args.base : undefined,
      path: typeof args.path === "string" ? args.path : undefined,
      pathOrBranch: typeof args.pathOrBranch === "string" ? args.pathOrBranch : undefined,
      openSessions: args.openSessions === true,
    });
    return result.ok ? result.output : result.error;
  },

  async fork(args, hctx) {
    const result = await forkWorktreeSession(hctx.ctx, hctx.sessionID, {
      name: typeof args.name === "string" ? args.name : undefined,
      branch: typeof args.branch === "string" ? args.branch : undefined,
      base: typeof args.base === "string" ? args.base : undefined,
      path: typeof args.path === "string" ? args.path : undefined,
      pathOrBranch: typeof args.pathOrBranch === "string" ? args.pathOrBranch : undefined,
      openSessions: args.openSessions === true,
    });
    return result.ok ? result.output : result.error;
  },

  async swarm(args, hctx) {
    const tasks = Array.isArray(args.tasks) ? args.tasks.map(String) : undefined;
    if (!tasks || tasks.length === 0) {
      return formatError("Tasks array is required.", { hint: "Provide one or more task names." });
    }
    const result = await swarmWorktrees(hctx.ctx, hctx.sessionID, {
      tasks,
      prefix: typeof args.prefix === "string" ? args.prefix : undefined,
      openSessions: args.openSessions === true,
      force: args.force === true,
    });
    return result.ok ? result.output : result.error;
  },

  async spawn(args, hctx) {
    const tasks = Array.isArray(args.tasks) ? args.tasks.map(String) : undefined;
    if (!tasks || tasks.length === 0) {
      return formatError("Tasks array is required.", { hint: "Provide one or more task names." });
    }
    const modelArg =
      typeof args.model === "object" && args.model !== null
        ? {
            providerID: (args.model as Record<string, unknown>).providerID as string,
            modelID: (args.model as Record<string, unknown>).modelID as string,
          }
        : undefined;
    const result = await spawnWorktrees(hctx.ctx, hctx.sessionID, {
      tasks,
      prefix: typeof args.prefix === "string" ? args.prefix : undefined,
      agent: typeof args.agent === "string" ? args.agent : undefined,
      prompt: typeof args.prompt === "string" ? args.prompt : undefined,
      model: modelArg,
    });
    return result.ok ? result.output : result.error;
  },

  async message(args, hctx) {
    const sessionID = typeof args.sessionID === "string" ? args.sessionID : "";
    const message = typeof args.message === "string" ? args.message : "";
    if (!sessionID) return formatError("sessionID is required.");
    if (!message) return formatError("message is required.");

    await hctx.ctx.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: message }],
        ...(typeof args.agent === "string" && args.agent ? { agent: args.agent } : {}),
      },
    });
    return `Message sent to session ${sessionID}`;
  },

  async notify(args, hctx) {
    const entry = await findSessionEntry(hctx.sessionID ?? "");
    if (!entry?.parentSessionID) {
      return formatError("No coordinator session found.", {
        hint: "This session was not spawned by a coordinator.",
      });
    }

    const message = typeof args.message === "string" ? args.message : "";
    if (!message) return formatError("message is required.");

    const level =
      typeof args.level === "string" && ["info", "warning", "blocking"].includes(args.level)
        ? args.level
        : "info";
    const levelPrefix = level === "blocking" ? "⚠️ BLOCKING" : level === "warning" ? "⚠️" : "";
    const taskInfo = entry.task ? ` [${entry.task}]` : ` [${entry.branch}]`;

    const text = [levelPrefix, taskInfo, message].filter(Boolean).join(" ");

    await hctx.ctx.client.session.promptAsync({
      path: { id: entry.parentSessionID },
      body: {
        parts: [{ type: "text", text }],
      },
    });

    if (level === "blocking") {
      await updateSessionStatus(hctx.sessionID ?? "", "failed");
    } else {
      await updateSessionStatus(hctx.sessionID ?? "", "completed");
    }

    return `Notified coordinator: ${text}`;
  },

  async sessions(args, _hctx) {
    const stateResult = await readState();
    if (!stateResult.ok) return stateResult.error;

    let entries = stateResult.state.entries;
    const sessionIDs = Array.isArray(args.sessionIDs) ? args.sessionIDs.map(String) : undefined;
    if (sessionIDs && sessionIDs.length > 0) {
      entries = entries.filter((e) => sessionIDs.includes(e.sessionID));
    }

    const statusFilter = typeof args.status === "string" ? args.status : undefined;
    if (statusFilter) {
      entries = entries.filter((e) => (e.status ?? "active") === statusFilter);
    }

    if (entries.length === 0) return "No sessions found.";

    const lines: string[] = [];
    lines.push("| sessionID | branch | task | status | worktreePath |");
    lines.push("|-----------|--------|------|--------|--------------|");
    for (const e of entries) {
      lines.push(
        `| ${e.sessionID} | ${e.branch} | ${e.task ?? "-"} | ${e.status ?? "active"} | ${e.worktreePath} |`,
      );
    }
    return lines.join("\n");
  },

  async abort(args, hctx) {
    const sessionID = typeof args.sessionID === "string" ? args.sessionID : "";
    if (!sessionID) return formatError("sessionID is required.");

    const entry = await findSessionEntry(sessionID);

    await hctx.ctx.client.session.abort({ path: { id: sessionID } });

    const lines = [`Session ${sessionID} aborted.`];

    if (entry) {
      await removeSessionMappings(sessionID);

      const removeResult = await removeWorktree(hctx.ctx, {
        pathOrBranch: entry.branch || entry.worktreePath,
        force: true,
      });

      if (removeResult.ok) {
        lines.push(`Worktree removed: ${entry.branch}`);
      } else {
        lines.push(`Warning: Could not remove worktree: ${removeResult.error}`);
      }
    } else {
      await updateSessionStatus(sessionID, "aborted");
    }

    return lines.join("\n");
  },

  async cleanup(args, hctx) {
    if (args.action === "prune") {
      const result = await pruneWorktrees(hctx.ctx, { dryRun: args.dryRun === true });
      return result.ok ? result.output : result.error;
    }

    if (args.action === "remove") {
      const pathOrBranch = typeof args.pathOrBranch === "string" ? args.pathOrBranch : "";
      if (!pathOrBranch) {
        return formatError("pathOrBranch is required.", {
          hint: "Provide a worktree path or branch name.",
        });
      }

      const stateResult = await readState();
      const matchingEntries =
        stateResult.ok && pathOrBranch.startsWith("wt/")
          ? stateResult.state.entries.filter((e) => e.branch === pathOrBranch)
          : stateResult.ok
            ? stateResult.state.entries.filter(
                (e) => e.branch === pathOrBranch || e.worktreePath === pathOrBranch,
              )
            : [];

      const result = await removeWorktree(hctx.ctx, {
        pathOrBranch,
        force: args.force === true,
        remote: args.remote === true,
      });

      if (result.ok) {
        for (const entry of matchingEntries) {
          await removeSessionMappingsByBranch(entry.branch);
        }
        if (matchingEntries.length > 0) {
          const stateInfo = `State entries removed: ${matchingEntries.length}`;
          return `${result.output}\n${stateInfo}`;
        }
      }

      return result.ok ? result.output : result.error;
    }

    if (args.action === "merged") {
      const prefix = typeof args.prefix === "string" ? args.prefix : "wt/";
      const listResult = await listMergedBranches(hctx.ctx, { prefix });
      if (!listResult.ok) return listResult.error;

      if (args.dryRun === true) {
        return `${listResult.output}\n\n(dry run — no branches were deleted)`;
      }

      const repoRoot = getRepoRoot(hctx.ctx);
      if (!repoRoot.ok) return repoRoot.error;

      const mergedResult = await runGit(hctx.ctx, ["branch", "--merged", "HEAD"], {
        cwd: repoRoot.path,
      });
      if (!mergedResult.ok) return formatGitFailure(mergedResult);

      const branches = mergedResult.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith(prefix) && l !== "main" && l !== "master");

      if (branches.length === 0) {
        return "No merged branches found matching prefix.";
      }

      const stateResult = await readState();

      const lines: string[] = [];
      for (const branch of branches) {
        const localResult = await runGit(hctx.ctx, ["branch", "-d", branch], {
          cwd: repoRoot.path,
        });
        const deleted = localResult.ok;
        lines.push(
          `Local branch ${branch}: ${deleted ? "deleted" : `failed (${localResult.stderr.trim()})`}`,
        );

        if (args.remote === true) {
          const remoteResult = await deleteRemoteBranch(hctx.ctx, branch);
          lines.push(`  Remote: ${remoteResult.ok ? remoteResult.output : remoteResult.error}`);
        }

        if (stateResult.ok) {
          const matches = stateResult.state.entries.filter((e) => e.branch === branch);
          for (const match of matches) {
            await removeSessionMappingsByBranch(match.branch);
          }
          if (matches.length > 0) {
            lines.push(`  State entries removed: ${matches.length}`);
          }
        }
      }

      lines.push(`\nCleaned up ${branches.length} merged branch(es).`);
      return lines.join("\n");
    }

    return formatError("action must be 'remove', 'prune', or 'merged'.", {
      hint: 'Use worktree({action: "cleanup", args: {action: "merged", dryRun: true}}) to preview merged branches.',
    });
  },

  async current(_args, hctx) {
    const entry = await findSessionEntry(hctx.sessionID ?? "");
    if (!entry) {
      return formatError("No worktree mapping found for current session.");
    }

    const lines: string[] = [];
    lines.push(`Session: ${entry.sessionID}`);
    lines.push(`Branch: ${entry.branch}`);
    lines.push(`Worktree: ${entry.worktreePath}`);
    if (entry.task) lines.push(`Task: ${entry.task}`);
    if (entry.parentSessionID) lines.push(`Coordinator: ${entry.parentSessionID}`);
    return lines.join("\n");
  },

  async merge(args, hctx) {
    const branch = typeof args.branch === "string" ? args.branch.trim() : "";
    if (!branch) {
      return formatError("branch is required.", {
        hint: "Provide the branch name to merge (e.g., 'wt/feature-auth').",
      });
    }

    const result = await mergeWorktreeBranch(hctx.ctx, {
      branch,
      target: typeof args.target === "string" ? args.target.trim() : undefined,
      deleteBranch: args.deleteBranch !== false,
      remote: args.remote === true,
    });

    if (result.ok) {
      const stateResult = await readState();
      if (stateResult.ok) {
        const matches = stateResult.state.entries.filter((e) => e.branch === branch);
        for (const match of matches) {
          await updateSessionStatus(match.sessionID, "completed");
        }
      }
    }

    return result.ok ? result.output : result.error;
  },
};

export const getAvailableOps = (role: "coordinator" | "implementation"): string[] => {
  const ops = role === "coordinator" ? COORDINATOR_OPS : IMPLEMENTATION_OPS;
  return [...ops].sort();
};

export const isOpAllowed = (op: string, role: "coordinator" | "implementation"): boolean => {
  const ops = role === "coordinator" ? COORDINATOR_OPS : IMPLEMENTATION_OPS;
  return ops.has(op);
};

export const route = async (
  action: string,
  args: ToolArgs,
  hctx: HandlerContext,
): Promise<string> => {
  const handler = handlers[action];
  if (!handler) {
    return `Unknown operation: ${action}. Call worktree({action: "help"}) for available operations.`;
  }

  if (!isOpAllowed(action, hctx.role)) {
    const available = getAvailableOps(hctx.role);
    return formatError(`Operation "${action}" is not available for ${hctx.role} sessions.`, {
      hint: `Available operations: ${available.join(", ")}`,
    });
  }

  try {
    return await handler(args, hctx);
  } catch (err) {
    return `Error in ${action}: ${err instanceof Error ? err.message : String(err)}`;
  }
};
