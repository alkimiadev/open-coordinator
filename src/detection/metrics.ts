import type { SessionMetrics } from "./types";

export const createSessionMetrics = (): SessionMetrics => ({
  toolErrors: 0,
  malformedTools: 0,
  abortedMessages: 0,
  lastActivityTime: Date.now(),
  lastStatus: "idle",
});

export const updateActivityTime = (metrics: SessionMetrics): SessionMetrics => {
  metrics.lastActivityTime = Date.now();
  return metrics;
};

export const incrementToolErrors = (metrics: SessionMetrics): SessionMetrics => {
  metrics.toolErrors++;
  return metrics;
};

export const incrementMalformedTools = (metrics: SessionMetrics): SessionMetrics => {
  metrics.malformedTools++;
  return metrics;
};

export const incrementAbortedMessages = (metrics: SessionMetrics): SessionMetrics => {
  metrics.abortedMessages++;
  return metrics;
};

export const updateSessionStatus = (
  metrics: SessionMetrics,
  status: "busy" | "idle",
): SessionMetrics => {
  metrics.lastStatus = status;
  return metrics;
};
