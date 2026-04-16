# Known Issues

## SSE Stream: Unbounded Reconnection & Listener Accumulation

**Severity:** High  
**Files:** `src/detection/index.ts`, SDK `serverSentEvents.gen.js`  
**Symptom:** `MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 event listeners added to [EventEmitter]` in opencode server logs.

### Root Cause

The detection module (`src/detection/index.ts:155`) calls `ctx.client.global.event()` to open an SSE stream. This goes through the SDK's `createSseClient`, which runs a `while(true)` reconnection loop with exponential backoff (3s base, 30s cap). The call passes **no `AbortController` signal** and **no `sseMaxRetryAttempts` limit**.

Each (re)connection to opencode's `/global/event` endpoint adds a `GlobalBus.on("event", handler)` listener on the server side (`packages/opencode/src/server/routes/global.ts:129`). While the server does clean up via `GlobalBus.off("event", handler)` when the old connection closes, there is a window during rapid reconnection where the old listener hasn't been removed yet but the new one is already registered. With fast enough reconnection cycles (e.g., during network flaps), listeners accumulate past Node's default 10-listener threshold, triggering the warning.

### Secondary Issues

1. **`setInterval` never cleared** (`src/detection/index.ts:118`): `startStallDetection` creates a `setInterval` but discards the return value. There is no `clearInterval` anywhere in the project. If `startDetection` were called more than once, multiple intervals would stack.

2. **`sessionMetrics` Map grows unbounded** (`src/detection/index.ts:17`): Entries are only deleted on `MODEL_DEGRADATION` or `HIGH_ERROR_COUNT` anomalies. Sessions that complete normally or are abandoned leave orphan entries in the map permanently.

### Fix (implemented)

1. **AbortController for clean shutdown** — `startDetection` now creates an `AbortController` and passes its `signal` to the SSE client options. This enables clean shutdown of the stream and the stall-detection interval. The `AbortController` is returned from `startDetection` so callers can abort it if needed.

2. **`sseMaxRetryAttempts` cap** — Set to 15, preventing the SDK's `while(true)` reconnection loop from retrying forever. After exhausting retries, the stream ends and the function returns.

3. **`clearInterval` on abort** — `startStallDetection` now stores the `setInterval` return value and registers an abort listener that calls `clearInterval`. No more orphaned intervals.

4. **`sessionMetrics` eviction on `session.deleted`** — `deleteSessionMetrics` is exported and called from the plugin's `event` handler when a `session.deleted` event is received. This prunes orphan entries when sessions are removed, complementing the existing eviction on anomaly detection.

5. **Plugin lifecycle wiring** — The `AbortController` is stored in the plugin setup so that the detection loop can be torn down. Since the plugin `Hooks` interface does not provide a `dispose` hook, the controller is made available for external cleanup if the plugin is ever unloaded or re-initialized.

### Reproducing

1. Run opencode with the open-coordinator plugin
2. Simulate network disruption to the `/global/event` SSE endpoint
3. Observe `MaxListenersExceededWarning` in opencode server logs as reconnections stack