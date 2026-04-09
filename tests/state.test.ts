import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readState, removeSessionMappings, storeSessionMapping } from "../src/state";

test("state read/write and removal", async () => {
  const original = process.env.XDG_CONFIG_HOME;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-coordinator-state-"));
  process.env.XDG_CONFIG_HOME = tempDir;

  try {
    const initial = await readState();
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.state.entries.length).toBe(0);

    const storeResult = await storeSessionMapping({
      worktreePath: "/repo/.worktrees/feature",
      branch: "feature",
      sessionID: "sess-1",
      createdAt: new Date().toISOString(),
    });
    expect(storeResult.ok).toBe(true);

    const afterStore = await readState();
    expect(afterStore.ok).toBe(true);
    if (!afterStore.ok) return;
    expect(afterStore.state.entries.length).toBe(1);

    const removeResult = await removeSessionMappings("sess-1");
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;
    expect(removeResult.removed).toBe(1);
  } finally {
    if (original === undefined) {
      process.env.XDG_CONFIG_HOME = undefined;
    } else {
      process.env.XDG_CONFIG_HOME = original;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
