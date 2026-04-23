import type { AnomalyInfo, AnomalyType, DetectionThresholds, SessionMetrics } from "./types";
import { DEFAULT_THRESHOLDS } from "./types";

export const detectMalformedTool = (
  metrics: SessionMetrics,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
): { detected: boolean; anomaly?: AnomalyInfo } => {
  if (metrics.malformedTools >= thresholds.malformedToolThreshold) {
    return {
      detected: true,
      anomaly: {
        issue: "Malformed tool calls detected",
        severity: "high",
        suggestion: "Consider aborting and switching models",
      },
    };
  }
  return { detected: false };
};

export const detectHighErrorCount = (
  metrics: SessionMetrics,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
): { detected: boolean; anomaly?: AnomalyInfo } => {
  if (metrics.toolErrors >= thresholds.toolErrorThreshold) {
    return {
      detected: true,
      anomaly: {
        issue: "High error count detected",
        severity: "medium",
        suggestion: "Check session for systemic issues",
        count: metrics.toolErrors,
      },
    };
  }
  return { detected: false };
};

export const detectSessionStall = (
  metrics: SessionMetrics,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
): { detected: boolean; anomaly?: AnomalyInfo } => {
  const now = Date.now();
  const elapsed = now - metrics.lastActivityTime;

  if (metrics.lastStatus === "busy" && elapsed > thresholds.stallThresholdMs) {
    return {
      detected: true,
      anomaly: {
        issue: "Session stalled - no activity while busy",
        severity: "medium",
        suggestion: "Session may be stalled. Send recovery message: 'please continue'",
        lastActivity: metrics.lastActivityTime,
      },
    };
  }
  return { detected: false };
};

export const checkAllAnomalies = (
  metrics: SessionMetrics,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
): Array<{ type: AnomalyType; anomaly: AnomalyInfo }> => {
  const anomalies: Array<{ type: AnomalyType; anomaly: AnomalyInfo }> = [];

  const malformedResult = detectMalformedTool(metrics, thresholds);
  if (malformedResult.detected && malformedResult.anomaly) {
    anomalies.push({ type: "MODEL_DEGRADATION", anomaly: malformedResult.anomaly });
  }

  const errorResult = detectHighErrorCount(metrics, thresholds);
  if (errorResult.detected && errorResult.anomaly) {
    anomalies.push({ type: "HIGH_ERROR_COUNT", anomaly: errorResult.anomaly });
  }

  const stallResult = detectSessionStall(metrics, thresholds);
  if (stallResult.detected && stallResult.anomaly) {
    anomalies.push({ type: "SESSION_STALL", anomaly: stallResult.anomaly });
  }

  return anomalies;
};
