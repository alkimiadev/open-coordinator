import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ensureConfigDir, getOpenTreesPath } from "./config";
import { formatError } from "./format";

export type SessionStatus = "active" | "completed" | "failed" | "aborted";

export type WorktreeSessionEntry = {
  worktreePath: string;
  branch: string;
  sessionID: string;
  parentSessionID?: string;
  task?: string;
  status?: SessionStatus;
  createdAt: string;
  completedAt?: string;
};

type WorktreeState = {
  entries: WorktreeSessionEntry[];
};

export const getStatePath = () => getOpenTreesPath("state.json");

const isValidEntry = (value: unknown): value is WorktreeSessionEntry => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.worktreePath === "string" &&
    typeof record.branch === "string" &&
    typeof record.sessionID === "string" &&
    typeof record.createdAt === "string"
  );
};

export const findSessionEntry = async (sessionID: string): Promise<WorktreeSessionEntry | null> => {
  const stateResult = await readState();
  if (!stateResult.ok) return null;
  return stateResult.state.entries.find((e) => e.sessionID === sessionID) ?? null;
};

const normalizeState = (value: unknown): WorktreeState => {
  if (!value || typeof value !== "object") return { entries: [] };
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.entries) ? record.entries.filter(isValidEntry) : [];
  return { entries };
};

export const readState = async (): Promise<
  { ok: true; state: WorktreeState; path: string } | { ok: false; error: string }
> => {
  const statePath = getStatePath();

  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return { ok: true, state: normalizeState(parsed), path: statePath };
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;

    if (errorCode === "ENOENT") {
      return { ok: true, state: { entries: [] }, path: statePath };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: formatError("Unable to read state file.", {
        details: message,
        hint: "Fix or remove the state file to recreate it.",
      }),
    };
  }
};

const writeState = async (statePath: string, state: WorktreeState) => {
  const dirResult = await ensureConfigDir(statePath);
  if (!dirResult.ok) return dirResult;

  const content = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = path.join(
    tmpdir(),
    `open-coordinator-state-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, statePath);
    return { ok: true as const };
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore cleanup failures
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: formatError("Unable to write state file.", {
        details: message,
      }),
    };
  }
};

export const storeSessionMapping = async (entry: WorktreeSessionEntry) => {
  const stateResult = await readState();
  if (!stateResult.ok) return stateResult;

  const filtered = stateResult.state.entries.filter(
    (existing) =>
      existing.worktreePath !== entry.worktreePath && existing.sessionID !== entry.sessionID,
  );
  const nextState: WorktreeState = { entries: [...filtered, entry] };

  const writeResult = await writeState(stateResult.path, nextState);
  if (!writeResult.ok) return writeResult;
  return { ok: true as const, path: stateResult.path };
};

export const removeSessionMappings = async (sessionID: string) => {
  const stateResult = await readState();
  if (!stateResult.ok) return stateResult;

  const nextEntries = stateResult.state.entries.filter((entry) => entry.sessionID !== sessionID);
  const removedCount = stateResult.state.entries.length - nextEntries.length;

  if (removedCount === 0) {
    return { ok: true as const, removed: 0, path: stateResult.path };
  }

  const writeResult = await writeState(stateResult.path, { entries: nextEntries });
  if (!writeResult.ok) return writeResult;
  return { ok: true as const, removed: removedCount, path: stateResult.path };
};

export const removeSessionMappingsByBranch = async (branch: string) => {
  const stateResult = await readState();
  if (!stateResult.ok) return stateResult;

  const nextEntries = stateResult.state.entries.filter((entry) => entry.branch !== branch);
  const removedCount = stateResult.state.entries.length - nextEntries.length;

  if (removedCount === 0) {
    return { ok: true as const, removed: 0, path: stateResult.path };
  }

  const writeResult = await writeState(stateResult.path, { entries: nextEntries });
  if (!writeResult.ok) return writeResult;
  return { ok: true as const, removed: removedCount, path: stateResult.path };
};

export const removeSessionMappingsByPath = async (worktreePath: string) => {
  const stateResult = await readState();
  if (!stateResult.ok) return stateResult;

  const nextEntries = stateResult.state.entries.filter(
    (entry) => entry.worktreePath !== worktreePath,
  );
  const removedCount = stateResult.state.entries.length - nextEntries.length;

  if (removedCount === 0) {
    return { ok: true as const, removed: 0, path: stateResult.path };
  }

  const writeResult = await writeState(stateResult.path, { entries: nextEntries });
  if (!writeResult.ok) return writeResult;
  return { ok: true as const, removed: removedCount, path: stateResult.path };
};

export const updateSessionStatus = async (sessionID: string, status: SessionStatus) => {
  const stateResult = await readState();
  if (!stateResult.ok) return stateResult;

  const entryIndex = stateResult.state.entries.findIndex((e) => e.sessionID === sessionID);
  if (entryIndex === -1) {
    return { ok: true as const, updated: false };
  }

  stateResult.state.entries[entryIndex] = {
    ...stateResult.state.entries[entryIndex],
    status,
    ...(status === "completed" || status === "failed" || status === "aborted"
      ? { completedAt: new Date().toISOString() }
      : {}),
  };

  const writeResult = await writeState(stateResult.path, stateResult.state);
  if (!writeResult.ok) return writeResult;
  return { ok: true as const, updated: true };
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

export const reconcileState = async () => {
  const stateResult = await readState();
  if (!stateResult.ok) {
    return { ok: false as const, error: stateResult.error };
  }

  const before = stateResult.state.entries.length;
  const kept: WorktreeSessionEntry[] = [];
  const removed: WorktreeSessionEntry[] = [];

  for (const entry of stateResult.state.entries) {
    const exists = await pathExists(entry.worktreePath);
    if (exists) {
      kept.push(entry);
    } else {
      removed.push(entry);
    }
  }

  if (removed.length === 0) {
    return { ok: true as const, removed: [] as WorktreeSessionEntry[], kept: before };
  }

  const writeResult = await writeState(stateResult.path, { entries: kept });
  if (!writeResult.ok) {
    return { ok: false as const, error: writeResult.error };
  }

  return { ok: true as const, removed, kept: kept.length };
};
