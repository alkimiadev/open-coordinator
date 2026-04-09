import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import { formatError } from "./format";
import { getRepoRoot } from "./git";
import { ensureModeEnabled, readMode, setMode } from "./mode";
import { getWorktreeRoot } from "./paths";
import type { ToolResult } from "./result";
import {
  createWorktree,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  statusWorktrees,
} from "./worktree";
import { dashboardWorktrees } from "./worktree-dashboard";
import { forkWorktreeSession, openWorktreeSession, startWorktreeSession } from "./worktree-session";
import { spawnWorktrees } from "./worktree-spawn";
import { swarmWorktrees } from "./worktree-swarm";
import { findSessionEntry, readState } from "./state";

const z = tool.schema;

const TOOL_CATALOG = [
  {
    id: "worktree_mode",
    summary: "Enable/disable worktree mode and show help.",
    examples: [
      "worktree_mode",
      'worktree_mode { "action": "on" }',
      'worktree_mode { "action": "off" }',
    ],
  },
  {
    id: "worktree_overview",
    summary: "List, status, or dashboard worktrees.",
    examples: [
      "worktree_overview",
      'worktree_overview { "view": "status" }',
      'worktree_overview { "view": "dashboard" }',
    ],
  },
  {
    id: "worktree_make",
    summary: "Create or open worktrees and sessions.",
    examples: [
      'worktree_make { "action": "create", "name": "feature audit" }',
      'worktree_make { "action": "start", "name": "feature audit", "openSessions": true }',
      'worktree_make { "action": "open", "pathOrBranch": "feature/audit" }',
    ],
  },
  {
    id: "worktree_cleanup",
    summary: "Remove or prune worktrees safely.",
    examples: [
      'worktree_cleanup { "action": "remove", "pathOrBranch": "feature/audit" }',
      'worktree_cleanup { "action": "prune", "dryRun": true }',
    ],
  },
];

const buildHelp = (modeEnabled: boolean, modePath: string, worktreeRoot?: string) => {
  const lines = [`Worktree mode: ${modeEnabled ? "ON" : "OFF"}`, `State: ${modePath}`];

  if (worktreeRoot) {
    lines.push(`Default worktree root: ${worktreeRoot}`);
  }

  lines.push("");
  lines.push("Tools:");
  for (const entry of TOOL_CATALOG) {
    lines.push(`- ${entry.id} — ${entry.summary}`);
  }

  lines.push("");
  lines.push("Examples:");
  for (const entry of TOOL_CATALOG) {
    for (const example of entry.examples) {
      lines.push(`- ${example}`);
    }
  }

  return lines.join("\n");
};

const renderToolResult = (result: ToolResult) => (result.ok ? result.output : result.error);

const runWhenEnabled = async (fn: () => Promise<ToolResult>) => {
  const modeResult = await ensureModeEnabled();
  if (!modeResult.ok) return modeResult.error;
  return renderToolResult(await fn());
};

export const createTools = (ctx: PluginInput): Record<string, ToolDefinition> => ({
  worktree_mode: tool({
    description: TOOL_CATALOG[0].summary,
    args: {
      action: z
        .enum(["on", "off", "status", "help"])
        .optional()
        .describe("Enable/disable worktree mode or show help."),
    },
    async execute(args) {
      const action = args.action ?? "status";

      if (action === "on" || action === "off") {
        const setResult = await setMode(action === "on");
        if (!setResult.ok) return setResult.error;
      }

      const modeResult = await readMode();
      if (!modeResult.ok) return modeResult.error;

      const repoRoot = await getRepoRoot(ctx);
      const worktreeRoot = repoRoot.ok ? getWorktreeRoot(repoRoot.path) : undefined;
      const help = buildHelp(modeResult.state.enabled, modeResult.path, worktreeRoot);

      if (action === "help") {
        return help;
      }

      if (action === "status") {
        return help;
      }

      return [`Worktree mode is now ${modeResult.state.enabled ? "ON" : "OFF"}.`, help].join(
        "\n\n",
      );
    },
  }),
  worktree_overview: tool({
    description: TOOL_CATALOG[1].summary,
    args: {
      view: z
        .enum(["list", "status", "dashboard"])
        .optional()
        .describe("Which overview to show (default: list)."),
      path: z.string().optional().describe("Filter to a specific worktree path (status view)."),
      all: z.boolean().optional().describe("Include all known worktrees (status view)."),
      porcelain: z.boolean().optional().describe("Include raw git status output (status view)."),
    },
    async execute(args) {
      return runWhenEnabled(async () => {
        const view = args.view ?? "list";
        if (view === "dashboard") return dashboardWorktrees(ctx);
        if (view === "status") {
          return statusWorktrees(ctx, {
            path: args.path,
            all: args.all,
            porcelain: args.porcelain,
          });
        }
        return listWorktrees(ctx);
      });
    },
  }),
  worktree_make: tool({
    description: TOOL_CATALOG[2].summary,
    args: {
      action: z
        .enum(["create", "start", "open", "fork", "swarm"])
        .describe("Create/open worktrees or sessions."),
      name: z.string().optional().describe("Logical name used to derive branch and folder."),
      branch: z.string().optional().describe("Explicit branch name (overrides derived name)."),
      base: z.string().optional().describe("Base ref for new branch (default: HEAD)."),
      path: z.string().optional().describe("Explicit filesystem path for the worktree."),
      pathOrBranch: z.string().optional().describe("Existing worktree path or branch to open."),
      openSessions: z.boolean().optional().describe("Open the sessions UI after creation."),
      tasks: z.array(z.string()).optional().describe("Task names for swarm worktrees."),
      prefix: z.string().optional().describe("Branch prefix for swarm worktrees (default: wt/)."),
      force: z.boolean().optional().describe("Allow existing branches or paths without skipping."),
    },
    async execute(args, context) {
      return runWhenEnabled(async () => {
        if (args.action === "create") {
          if (!args.name && !args.branch) {
            return {
              ok: false,
              error: formatError("Name or branch is required.", {
                hint: "Provide name (for derived branch) or an explicit branch.",
              }),
            };
          }
          return createWorktree(ctx, args);
        }

        if (args.action === "start") {
          return startWorktreeSession(ctx, args);
        }

        if (args.action === "open") {
          if (!args.pathOrBranch && !args.path && !args.name && !args.branch) {
            return {
              ok: false,
              error: formatError("Path or branch is required.", {
                hint: "Provide pathOrBranch, path, name, or branch to open.",
              }),
            };
          }
          return openWorktreeSession(ctx, args);
        }

        if (args.action === "fork") {
          return forkWorktreeSession(ctx, context.sessionID, args);
        }

        if (!args.tasks || args.tasks.length === 0) {
          return {
            ok: false,
            error: formatError("Tasks array is required.", {
              hint: "Provide one or more task names.",
            }),
          };
        }

        return swarmWorktrees(ctx, context.sessionID, {
          tasks: args.tasks,
          prefix: args.prefix,
          openSessions: args.openSessions,
          force: args.force,
        });
      });
    },
  }),
  worktree_cleanup: tool({
    description: TOOL_CATALOG[3].summary,
    args: {
      action: z.enum(["remove", "prune"]).describe("Remove or prune worktrees."),
      pathOrBranch: z.string().optional().describe("Worktree path or branch name to remove."),
      force: z.boolean().optional().describe("Remove even if the worktree has local changes."),
      dryRun: z.boolean().optional().describe("Preview prune results."),
    },
    async execute(args) {
      return runWhenEnabled(async () => {
        if (args.action === "prune") {
          return pruneWorktrees(ctx, { dryRun: args.dryRun });
        }

        if (!args.pathOrBranch) {
          return {
            ok: false,
            error: formatError("pathOrBranch is required.", {
              hint: "Provide a worktree path or branch name.",
            }),
          };
        }

        return removeWorktree(ctx, { pathOrBranch: args.pathOrBranch, force: args.force });
      });
    },
  }),
  worktree_spawn: tool({
    description:
      "Create worktrees and sessions, then send initial prompts asynchronously. Returns immediately with session IDs.",
    args: {
      tasks: z.array(z.string()).describe("Task names/IDs to spawn."),
      prefix: z.string().optional().describe("Branch prefix (default: wt/)."),
      agent: z.string().optional().describe("Agent to use for sessions."),
      prompt: z
        .string()
        .optional()
        .describe("Prompt template. Use {{task}} for task name substitution."),
    },
    async execute(args, context) {
      return runWhenEnabled(async () =>
        spawnWorktrees(ctx, context.sessionID, {
          tasks: args.tasks,
          prefix: args.prefix,
          agent: args.agent,
          prompt: args.prompt,
        }),
      );
    },
  }),
  worktree_message: tool({
    description: "Send a message to a spawned session for recovery or check-ins.",
    args: {
      sessionID: z.string().describe("Target session ID."),
      message: z.string().describe("Message content."),
      agent: z.string().optional().describe("Agent to use (optional)."),
    },
    async execute(args) {
      return runWhenEnabled(async () => {
        await ctx.client.session.promptAsync({
          path: { id: args.sessionID },
          body: {
            parts: [{ type: "text", text: args.message }],
            ...(args.agent && { agent: args.agent }),
          },
        });
        return { ok: true, output: `Message sent to session ${args.sessionID}` };
      });
    },
  }),
  worktree_notify: tool({
    description:
      "Send a message to the coordinator session. Use this to report completion, blocking issues, or request guidance.",
    args: {
      message: z.string().describe("Message content."),
      level: z.enum(["info", "warning", "blocking"]).optional().describe("Priority level."),
    },
    async execute(args, context) {
      return runWhenEnabled(async () => {
        const entry = await findSessionEntry(context.sessionID);
        if (!entry?.parentSessionID) {
          return {
            ok: false,
            error: formatError("No coordinator session found.", {
              hint: "This session was not spawned by a coordinator.",
            }),
          };
        }

        const level = args.level ?? "info";
        const levelPrefix = level === "blocking" ? "⚠️ BLOCKING" : level === "warning" ? "⚠️" : "";
        const taskInfo = entry.task ? ` [${entry.task}]` : ` [${entry.branch}]`;

        const text = [levelPrefix, taskInfo, args.message].filter(Boolean).join(" ");

        await ctx.client.session.promptAsync({
          path: { id: entry.parentSessionID },
          body: {
            parts: [{ type: "text", text }],
          },
        });

        return { ok: true, output: `Notified coordinator: ${text}` };
      });
    },
  }),
  worktree_status: tool({
    description: "Query status of spawned sessions.",
    args: {
      sessionIDs: z.array(z.string()).optional().describe("Filter to specific sessions."),
    },
    async execute(args) {
      return runWhenEnabled(async () => {
        const stateResult = await readState();
        if (!stateResult.ok) return stateResult;

        let entries = stateResult.state.entries;
        if (args.sessionIDs && args.sessionIDs.length > 0) {
          entries = entries.filter((e) => args.sessionIDs?.includes(e.sessionID));
        }

        if (entries.length === 0) {
          return { ok: true, output: "No sessions found." };
        }

        const lines: string[] = [];
        lines.push("| sessionID | branch | task | worktreePath |");
        lines.push("|-----------|--------|------|--------------|");
        for (const e of entries) {
          lines.push(`| ${e.sessionID} | ${e.branch} | ${e.task ?? "-"} | ${e.worktreePath} |`);
        }

        return { ok: true, output: lines.join("\n") };
      });
    },
  }),
  worktree_abort: tool({
    description: "Abort a spawned session.",
    args: {
      sessionID: z.string().describe("Session to abort."),
    },
    async execute(args) {
      return runWhenEnabled(async () => {
        await ctx.client.session.abort({
          path: { id: args.sessionID },
        });
        return { ok: true, output: `Session ${args.sessionID} aborted.` };
      });
    },
  }),
  worktree_current: tool({
    description: "Query the worktree mapping for the current session.",
    args: {},
    async execute(_args, context) {
      return runWhenEnabled(async () => {
        const entry = await findSessionEntry(context.sessionID);
        if (!entry) {
          return {
            ok: false,
            error: formatError("No worktree mapping found for current session."),
          };
        }

        const lines: string[] = [];
        lines.push(`Session: ${entry.sessionID}`);
        lines.push(`Branch: ${entry.branch}`);
        lines.push(`Worktree: ${entry.worktreePath}`);
        if (entry.task) lines.push(`Task: ${entry.task}`);
        if (entry.parentSessionID) lines.push(`Coordinator: ${entry.parentSessionID}`);

        return { ok: true, output: lines.join("\n") };
      });
    },
  }),
});
