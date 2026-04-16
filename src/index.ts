import type { Plugin } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { deleteSessionMetrics, startDetection } from "./detection";
import { findSessionEntry, removeSessionMappings } from "./state";
import { createTools } from "./tools";

const getDeletedSessionId = (event: Event) =>
  event.type === "session.deleted" ? event.properties.info.id : "";

const OpenTreesPlugin: Plugin = async (ctx) => {
  const detectionController = startDetection(ctx);

  return {
    tool: createTools(ctx),
    event: async ({ event }) => {
      const sessionID = getDeletedSessionId(event);
      if (!sessionID) return;
      deleteSessionMetrics(sessionID);
      await removeSessionMappings(sessionID);
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash" && input.sessionID) {
        const entry = await findSessionEntry(input.sessionID);
        if (entry && !output.args.workdir) {
          output.args.workdir = entry.worktreePath;
        }
      }
    },
    "shell.env": async (input, output) => {
      if (input.sessionID) {
        const entry = await findSessionEntry(input.sessionID);
        if (entry) {
          output.env.OPENCODE_WORKTREE_PATH = entry.worktreePath;
          output.env.OPENCODE_WORKTREE_BRANCH = entry.branch;
        }
      }
    },
    "experimental.session.compacting": async (_input, output) => {
      output.prompt = `You are compacting your own session to free context space.

Include what YOU will need to effectively resume your work:
- Current task and progress
- Files being worked on
- Key decisions made and why
- Next steps to take
- Important context that would be hard to rediscover

Be concise but preserve enough detail that you can continue seamlessly.
You are summarizing for yourself, not another agent.`;
    },
  };
};

export default OpenTreesPlugin;
