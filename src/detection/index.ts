import type { PluginInput } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import type { WorktreeSessionEntry } from "../state";
import { findSessionEntry, readState } from "../state";
import {
  createSessionMetrics,
  updateActivityTime,
  incrementToolErrors,
  incrementMalformedTools,
  updateSessionStatus,
} from "./metrics";
import { checkAllAnomalies } from "./heuristics";
import { notifyCoordinator } from "./notify";
import type { SessionMetrics, DetectionThresholds } from "./types";
import { DEFAULT_THRESHOLDS } from "./types";

const sessionMetrics = new Map<string, SessionMetrics>();

const isSpawnedSession = async (sessionID: string): Promise<boolean> => {
  const stateResult = await readState();
  if (!stateResult.ok) return false;
  return stateResult.state.entries.some((e) => e.sessionID === sessionID);
};

const getSessionEntry = async (sessionID: string): Promise<WorktreeSessionEntry | null> => {
  return await findSessionEntry(sessionID);
};

const extractSessionID = (event: Event): string | null => {
  const props = event.properties as Record<string, unknown> | undefined;
  if (!props) return null;

  if ("sessionID" in props && typeof props.sessionID === "string") {
    return props.sessionID;
  }

  if ("info" in props && typeof props.info === "object" && props.info !== null) {
    const info = props.info as Record<string, unknown>;
    if ("id" in info && typeof info.id === "string") {
      return info.id;
    }
  }

  return null;
};

const handleEvent = async (
  ctx: PluginInput,
  event: Event,
  thresholds: DetectionThresholds,
): Promise<void> => {
  const sessionID = extractSessionID(event);
  if (!sessionID) return;

  const isSpawned = await isSpawnedSession(sessionID);
  if (!isSpawned) return;

  let metrics = sessionMetrics.get(sessionID) ?? createSessionMetrics();
  metrics = updateActivityTime(metrics);

  if (event.type === "session.status") {
    const status = event.properties?.status;
    if (status && typeof status === "object" && "type" in status) {
      const statusType = status.type;
      if (statusType === "busy" || statusType === "idle") {
        metrics = updateSessionStatus(metrics, statusType);
      }
    }
  }

  if (event.type === "message.part.updated") {
    const part = event.properties?.part;
    if (!part || typeof part !== "object") return;

    if ("type" in part && part.type === "tool") {
      if ("tool" in part && part.tool === "tool") {
        metrics = incrementMalformedTools(metrics);
      }

      if ("state" in part && typeof part.state === "object" && "status" in part.state) {
        if (part.state.status === "error") {
          metrics = incrementToolErrors(metrics);
        }
      }
    }
  }

  sessionMetrics.set(sessionID, metrics);

  const anomalies = checkAllAnomalies(metrics, thresholds);
  if (anomalies.length > 0) {
    const entry = await getSessionEntry(sessionID);

    for (const { type, anomaly } of anomalies) {
      if (entry?.parentSessionID) {
        try {
          await notifyCoordinator(
            ctx.client,
            entry.parentSessionID,
            sessionID,
            type,
            anomaly,
            entry,
          );
        } catch (error) {
          console.error(`Failed to notify coordinator for ${sessionID}:`, error);
        }
      }
    }

    if (anomalies.some((a) => a.type === "MODEL_DEGRADATION" || a.type === "HIGH_ERROR_COUNT")) {
      sessionMetrics.delete(sessionID);
    }
  }
};

const startStallDetection = (ctx: PluginInput, thresholds: DetectionThresholds): void => {
  setInterval(async () => {
    const now = Date.now();

    for (const [sessionID, metrics] of sessionMetrics) {
      const anomalies = checkAllAnomalies(metrics, thresholds);
      const stallAnomaly = anomalies.find((a) => a.type === "SESSION_STALL");

      if (stallAnomaly) {
        const entry = await getSessionEntry(sessionID);

        if (entry?.parentSessionID) {
          try {
            await notifyCoordinator(
              ctx.client,
              entry.parentSessionID,
              sessionID,
              stallAnomaly.type,
              stallAnomaly.anomaly,
              entry,
            );
          } catch (error) {
            console.error(`Failed to notify coordinator for stall ${sessionID}:`, error);
          }
        }

        metrics.lastActivityTime = now;
        sessionMetrics.set(sessionID, metrics);
      }
    }
  }, thresholds.stallCheckIntervalMs);
};

export const startDetection = async (
  ctx: PluginInput,
  thresholds = DEFAULT_THRESHOLDS,
): Promise<void> => {
  try {
    const eventStreamResult = await ctx.client.global.event();

    startStallDetection(ctx, thresholds);

    const stream = eventStreamResult.stream;
    for await (const event of stream) {
      await handleEvent(ctx, event as unknown as Event, thresholds);
    }
  } catch (error) {
    console.error("Detection loop error:", error);
  }
};

export { sessionMetrics };
