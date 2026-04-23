import type { OpencodeClient } from "@opencode-ai/sdk";
import type { WorktreeSessionEntry } from "../state";
import type { AnomalyInfo, AnomalyType } from "./types";

export const formatAnomalyNotification = (
  sessionID: string,
  type: AnomalyType,
  anomaly: AnomalyInfo,
  entry?: WorktreeSessionEntry | null,
): string => {
  const lines: string[] = [];

  const branchInfo = entry?.branch ?? "unknown";
  const taskInfo = entry?.task ?? branchInfo;

  lines.push(`⚠️ ANOMALY DETECTED [${taskInfo}]`);
  lines.push("");
  lines.push(`Session: ${sessionID}`);
  lines.push(`Branch: ${branchInfo}`);
  lines.push(`Issue: ${type} (${anomaly.severity} severity)`);
  lines.push("");

  if (type === "MODEL_DEGRADATION") {
    lines.push("The model appears to be in a degraded state with malformed tool calls.");
    lines.push("Consider:");
    lines.push("1. Send recovery message first");
    lines.push("2. Abort if no improvement");
    lines.push("");
    lines.push(`Run: worktree({action: "abort", args: {sessionID: "${sessionID}"}})`);
  } else if (type === "SESSION_STALL") {
    lines.push("No activity detected while session is busy.");
    lines.push("This may be an OpenCode parsing bug. The model can usually recover.");
    lines.push(`Consider sending: "There was an error, please continue."`);
    lines.push("");
    lines.push(
      `Run: worktree({action: "message", args: {sessionID: "${sessionID}", message: "please continue"}})`,
    );
  } else if (type === "HIGH_ERROR_COUNT") {
    lines.push(`Detected ${anomaly.count ?? "multiple"} tool errors in this session.`);
    lines.push("This could indicate:");
    lines.push("- Systemic issues with the task");
    lines.push("- Environment problems");
    lines.push("- Model confusion");
    lines.push("");
    lines.push("Consider checking the session or sending guidance.");
  }

  if (anomaly.suggestion) {
    lines.push("");
    lines.push(`Suggestion: ${anomaly.suggestion}`);
  }

  return lines.join("\n");
};

export const notifyCoordinator = async (
  client: OpencodeClient,
  parentSessionID: string,
  sessionID: string,
  type: AnomalyType,
  anomaly: AnomalyInfo,
  entry?: WorktreeSessionEntry | null,
): Promise<void> => {
  const notification = formatAnomalyNotification(sessionID, type, anomaly, entry);

  await client.session.promptAsync({
    path: { id: parentSessionID },
    body: {
      parts: [{ type: "text" as const, text: notification }],
    },
  });
};
