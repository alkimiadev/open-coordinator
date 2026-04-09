import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureModeEnabled, readMode, setMode } from "../src/mode";

test("mode state toggles and gates worktree tools", async () => {
  const original = process.env.XDG_CONFIG_HOME;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-coordinator-mode-"));
  process.env.XDG_CONFIG_HOME = tempDir;

  try {
    const initial = await readMode();
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.state.enabled).toBe(false);

    const gated = await ensureModeEnabled();
    expect(gated.ok).toBe(false);

    const setOn = await setMode(true);
    expect(setOn.ok).toBe(true);

    const enabled = await ensureModeEnabled();
    expect(enabled.ok).toBe(true);
  } finally {
    if (original === undefined) {
      process.env.XDG_CONFIG_HOME = undefined;
    } else {
      process.env.XDG_CONFIG_HOME = original;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
