import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { formatError } from "./format";

export const getConfigRoot = () => {
  const envPath = process.env.XDG_CONFIG_HOME;
  return envPath ? path.resolve(envPath) : path.join(os.homedir(), ".config");
};

export const getOpenTreesPath = (filename: string) =>
  path.join(getConfigRoot(), "opencode", "open-coordinator", filename);

export const ensureConfigDir = async (targetPath: string) => {
  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: formatError("Unable to create config directory.", {
        details: message,
      }),
    };
  }
};
