import { expect, test } from "bun:test";

import {
  createSessionMetrics,
  updateActivityTime,
  incrementToolErrors,
  incrementMalformedTools,
  updateSessionStatus,
} from "../src/detection/metrics";
import {
  detectMalformedTool,
  detectHighErrorCount,
  detectSessionStall,
} from "../src/detection/heuristics";

test("createSessionMetrics initializes with defaults", () => {
  const metrics = createSessionMetrics();
  expect(metrics.toolErrors).toBe(0);
  expect(metrics.malformedTools).toBe(0);
  expect(metrics.abortedMessages).toBe(0);
  expect(metrics.lastStatus).toBe("idle");
  expect(metrics.lastActivityTime).toBeGreaterThan(0);
});

test("updateActivityTime updates timestamp", () => {
  const metrics = createSessionMetrics();
  const before = metrics.lastActivityTime;

  const updated = updateActivityTime(metrics);

  expect(updated.lastActivityTime).toBeGreaterThanOrEqual(before);
});

test("incrementToolErrors increases count", () => {
  const metrics = createSessionMetrics();
  expect(metrics.toolErrors).toBe(0);

  incrementToolErrors(metrics);
  expect(metrics.toolErrors).toBe(1);

  incrementToolErrors(metrics);
  expect(metrics.toolErrors).toBe(2);
});

test("incrementMalformedTools increases count", () => {
  const metrics = createSessionMetrics();
  expect(metrics.malformedTools).toBe(0);

  incrementMalformedTools(metrics);
  expect(metrics.malformedTools).toBe(1);
});

test("updateSessionStatus changes status", () => {
  const metrics = createSessionMetrics();
  expect(metrics.lastStatus).toBe("idle");

  updateSessionStatus(metrics, "busy");
  expect(metrics.lastStatus).toBe("busy");

  updateSessionStatus(metrics, "idle");
  expect(metrics.lastStatus).toBe("idle");
});

test("detectMalformedTool detects anomaly at threshold", () => {
  const metrics = createSessionMetrics();

  let result = detectMalformedTool(metrics);
  expect(result.detected).toBe(false);

  incrementMalformedTools(metrics);
  result = detectMalformedTool(metrics);
  expect(result.detected).toBe(true);
  expect(result.anomaly?.issue).toContain("Malformed tool calls");
  expect(result.anomaly?.severity).toBe("high");
});

test("detectHighErrorCount detects anomaly at threshold", () => {
  const metrics = createSessionMetrics();

  let result = detectHighErrorCount(metrics);
  expect(result.detected).toBe(false);

  for (let i = 0; i < 4; i++) {
    incrementToolErrors(metrics);
  }
  result = detectHighErrorCount(metrics);
  expect(result.detected).toBe(false);

  incrementToolErrors(metrics);
  result = detectHighErrorCount(metrics);
  expect(result.detected).toBe(true);
  expect(result.anomaly?.issue).toContain("High error count");
  expect(result.anomaly?.severity).toBe("medium");
  expect(result.anomaly?.count).toBe(5);
});

test("detectSessionStall detects anomaly when busy and stale", () => {
  const metrics = createSessionMetrics();
  metrics.lastActivityTime = Date.now() - 70_000;
  updateSessionStatus(metrics, "busy");

  const result = detectSessionStall(metrics);
  expect(result.detected).toBe(true);
  expect(result.anomaly?.issue).toContain("Session stalled");
  expect(result.anomaly?.severity).toBe("medium");
});

test("detectSessionStall does not detect when idle", () => {
  const metrics = createSessionMetrics();
  metrics.lastActivityTime = Date.now() - 70_000;
  updateSessionStatus(metrics, "idle");

  const result = detectSessionStall(metrics);
  expect(result.detected).toBe(false);
});

test("detectSessionStall does not detect when recent activity", () => {
  const metrics = createSessionMetrics();
  updateSessionStatus(metrics, "busy");

  const result = detectSessionStall(metrics);
  expect(result.detected).toBe(false);
});
