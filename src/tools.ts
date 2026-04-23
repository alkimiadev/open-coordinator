import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { detectRole, route } from "./registry";

const z = tool.schema;

export const createTools = (ctx: PluginInput): Record<string, ToolDefinition> => ({
  worktree: tool({
    description:
      "Worktree coordinator: manage git worktrees, sessions, and communication. Call with {action: 'help'} to see available operations.",
    args: {
      action: z
        .string()
        .describe(
          "Operation name: help, list, status, dashboard, create, start, open, fork, swarm, spawn, message, notify, sessions, abort, cleanup, current.",
        ),
      args: z.record(z.string(), z.unknown()).optional().describe("Arguments for the operation."),
    },
    async execute(input, context) {
      const role = await detectRole(context.sessionID);
      return route(input.action, (input.args as Record<string, unknown>) ?? {}, {
        ctx,
        sessionID: context.sessionID,
        role,
      });
    },
  }),
});
