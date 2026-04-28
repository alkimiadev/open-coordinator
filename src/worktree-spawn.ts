import type { PluginInput } from "@opencode-ai/plugin";

import { formatError } from "./format";
import { getRepoRoot } from "./git";
import { normalizeBranchName } from "./paths";
import { err, ok, type ToolResult } from "./result";
import { unwrapSdkResponse } from "./sdk";
import { storeSessionMapping } from "./state";
import { createWorktreeDetails } from "./worktree";

type SpawnOptions = {
  tasks: string[];
  prefix?: string;
  agent?: string;
  prompt?: string;
  model?: { providerID: string; modelID: string };
};

type SpawnedSession = {
  task: string;
  sessionID: string;
  branch: string;
  worktreePath: string;
};

export const substituteTemplate = (template: string, task: string) => {
  return template.replace(/\{\{task\}\}/g, task);
};

type MessageWithInfo = {
  info: {
    role: string;
    modelID?: string;
    providerID?: string;
  };
};

const resolveCoordinatorModel = async (
  ctx: PluginInput,
  coordinatorSessionID: string,
): Promise<{ providerID: string; modelID: string } | null> => {
  try {
    const response = await ctx.client.session.messages({
      path: { id: coordinatorSessionID },
      query: { limit: 20 },
    });
    const result = unwrapSdkResponse<MessageWithInfo[]>(response, "Session messages");
    if (!result.ok) return null;

    const messages = result.data;
    if (!Array.isArray(messages)) return null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i]?.info;
      if (info?.role === "assistant" && info.modelID && info.providerID) {
        return {
          modelID: info.modelID,
          providerID: info.providerID,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const spawnWorktrees = async (
  ctx: PluginInput,
  parentSessionID: string | undefined,
  options: SpawnOptions,
): Promise<ToolResult> => {
  if (!parentSessionID) {
    return err(
      formatError("Current session ID is unavailable.", {
        hint: "Run this tool from within an OpenCode session.",
      }),
    );
  }

  if (!options.tasks || options.tasks.length === 0) {
    return err(
      formatError("Tasks array is required.", {
        hint: "Provide one or more task names.",
      }),
    );
  }

  const repoRoot = getRepoRoot(ctx);
  if (!repoRoot.ok) return err(repoRoot.error);

  const effectiveModel = options.model ?? (await resolveCoordinatorModel(ctx, parentSessionID));

  const prefix = options.prefix ?? "wt/";
  const spawned: SpawnedSession[] = [];
  const errors: string[] = [];

  for (const task of options.tasks) {
    const rawTask = task.trim();
    if (!rawTask) {
      errors.push("Skipped empty task");
      continue;
    }

    const normalizedTask = normalizeBranchName(rawTask);
    if (!normalizedTask) {
      errors.push(`Skipped invalid task name: ${rawTask}`);
      continue;
    }

    const branch = `${prefix}${normalizedTask}`;

    const worktreeResult = await createWorktreeDetails(ctx, {
      name: rawTask,
      branch,
    });
    if (!worktreeResult.ok) {
      errors.push(`${branch}: ${worktreeResult.error}`);
      continue;
    }

    const title = `wt:${branch}`;
    const createResponse = await ctx.client.session.create({
      query: { directory: worktreeResult.result.worktreePath },
      body: { title, parentID: parentSessionID },
    });
    const createResult = unwrapSdkResponse<{ id: string }>(createResponse, "Session create");
    if (!createResult.ok) {
      errors.push(`${branch}: ${createResult.error}`);
      continue;
    }

    const sessionID = createResult.data.id;
    if (!sessionID) {
      errors.push(`${branch}: Session create returned no ID`);
      continue;
    }

    const createdAt = new Date().toISOString();
    const mappingResult = await storeSessionMapping({
      worktreePath: worktreeResult.result.worktreePath,
      branch: worktreeResult.result.branch,
      sessionID,
      parentSessionID,
      task: rawTask,
      status: "active",
      createdAt,
    });

    if (!mappingResult.ok) {
      errors.push(`${branch}: ${mappingResult.error}`);
    }

    if (options.prompt) {
      const promptText = substituteTemplate(options.prompt, rawTask);
      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: promptText }],
          ...(options.agent && { agent: options.agent }),
          ...(effectiveModel && { model: effectiveModel }),
        },
      });
    }

    spawned.push({
      task: rawTask,
      sessionID,
      branch: worktreeResult.result.branch,
      worktreePath: worktreeResult.result.worktreePath,
    });
  }

  const lines: string[] = [];
  lines.push(`Spawned ${spawned.length}/${options.tasks.length} sessions.`);
  lines.push("");
  lines.push("| task | sessionID | branch | worktreePath |");
  lines.push("|------|-----------|--------|--------------|");
  for (const s of spawned) {
    lines.push(`| ${s.task} | ${s.sessionID} | ${s.branch} | ${s.worktreePath} |`);
  }

  if (effectiveModel) {
    lines.push("");
    lines.push(
      `Model: ${effectiveModel.providerID}/${effectiveModel.modelID}${options.model ? " (explicit)" : " (inherited from coordinator)"}`,
    );
  }

  if (errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const e of errors) {
      lines.push(`- ${e}`);
    }
  }

  lines.push("");
  lines.push("Sessions are running asynchronously in the background.");
  lines.push('Use worktree({action: "sessions"}) to check progress.');

  return ok(lines.join("\n"));
};
