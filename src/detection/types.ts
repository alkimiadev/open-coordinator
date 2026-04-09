export type SessionMetrics = {
  toolErrors: number;
  malformedTools: number;
  abortedMessages: number;
  lastActivityTime: number;
  lastStatus: "busy" | "idle";
};

export type AnomalyType = "MODEL_DEGRADATION" | "HIGH_ERROR_COUNT" | "SESSION_STALL";

export type AnomalySeverity = "high" | "medium" | "low";

export type AnomalyInfo = {
  issue: string;
  severity: AnomalySeverity;
  suggestion?: string;
  count?: number;
  lastActivity?: number;
};

export type DetectionThresholds = {
  toolErrorThreshold: number;
  malformedToolThreshold: number;
  stallThresholdMs: number;
  stallCheckIntervalMs: number;
};

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  toolErrorThreshold: 5,
  malformedToolThreshold: 1,
  stallThresholdMs: 60_000,
  stallCheckIntervalMs: 30_000,
};
