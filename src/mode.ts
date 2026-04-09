import { readFile, writeFile } from "node:fs/promises";

import { ensureConfigDir, getOpenTreesPath } from "./config";
import { formatError } from "./format";

type WorktreeModeState = {
  enabled: boolean;
  updatedAt: string;
};

const defaultState: WorktreeModeState = {
  enabled: false,
  updatedAt: new Date(0).toISOString(),
};

const normalizeState = (value: unknown): WorktreeModeState => {
  if (!value || typeof value !== "object") return defaultState;
  const record = value as Record<string, unknown>;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : defaultState.enabled;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
      ? record.updatedAt
      : defaultState.updatedAt;
  return { enabled, updatedAt };
};

export const getModePath = () => getOpenTreesPath("mode.json");

export const readMode = async (): Promise<
  { ok: true; state: WorktreeModeState; path: string } | { ok: false; error: string }
> => {
  const modePath = getModePath();

  try {
    const raw = await readFile(modePath, "utf8");
    const parsed = JSON.parse(raw);
    return { ok: true, state: normalizeState(parsed), path: modePath };
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;

    if (errorCode === "ENOENT") {
      return { ok: true, state: defaultState, path: modePath };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: formatError("Unable to read worktree mode state.", {
        details: message,
      }),
    };
  }
};

export const setMode = async (enabled: boolean) => {
  const modePath = getModePath();
  const dirResult = await ensureConfigDir(modePath);
  if (!dirResult.ok) return dirResult;

  const state: WorktreeModeState = { enabled, updatedAt: new Date().toISOString() };
  const content = `${JSON.stringify(state, null, 2)}\n`;
  try {
    await writeFile(modePath, content, "utf8");
    return { ok: true as const, state, path: modePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: formatError("Unable to write worktree mode state.", {
        details: message,
      }),
    };
  }
};

export const ensureModeEnabled = async () => {
  const modeResult = await readMode();
  if (!modeResult.ok) return modeResult;
  if (!modeResult.state.enabled) {
    return {
      ok: false as const,
      error: formatError("Worktree mode is off.", {
        hint: 'Run worktree_mode { "action": "on" } to enable.',
      }),
    };
  }
  return modeResult;
};
