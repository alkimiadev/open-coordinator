import { mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

export type MockSessionCreateResult = {
  id: string;
};

export type MockSession = {
  create: ReturnType<typeof mock>;
  promptAsync: ReturnType<typeof mock>;
  update: ReturnType<typeof mock>;
  abort: ReturnType<typeof mock>;
  status: ReturnType<typeof mock>;
  messages: ReturnType<typeof mock>;
};

export type MockClient = {
  session: MockSession;
  tui: {
    openSessions: ReturnType<typeof mock>;
  };
  app: {
    log: ReturnType<typeof mock>;
  };
};

export const createMockSession = (overrides?: Partial<MockSession>): MockSession => {
  return {
    create: mock().mockResolvedValue({ data: { id: "test-session-id" } }),
    promptAsync: mock().mockResolvedValue({ data: {} }),
    update: mock().mockResolvedValue({ data: {} }),
    abort: mock().mockResolvedValue({ data: {} }),
    status: mock().mockResolvedValue({ data: { type: "idle" } }),
    messages: mock().mockResolvedValue({ data: [] }),
    ...overrides,
  };
};

export const createMockClient = (sessionOverrides?: Partial<MockSession>): MockClient => {
  return {
    session: createMockSession(sessionOverrides),
    tui: {
      openSessions: mock().mockResolvedValue({ data: {} }),
    },
    app: {
      log: mock().mockResolvedValue({ data: {} }),
    },
  };
};

export const createMockPluginInput = (overrides?: Partial<PluginInput>): PluginInput => {
  const defaultInput: PluginInput = {
    client: createMockClient(),
    project: { id: "test-project", path: "/test/repo" },
    directory: "/test/repo",
    worktree: "/test/repo",
    session: { id: "test-parent-session" },
  };

  return {
    ...defaultInput,
    ...overrides,
  } as PluginInput;
};

export const createMockSessionCreateResponse = (sessionId: string) => {
  return { data: { id: sessionId } };
};

export const createMockSessionCreateError = (error: string | Error) => {
  return { error: typeof error === "string" ? { message: error } : error };
};

export const setupTempStateDir = async () => {
  const original = process.env.XDG_CONFIG_HOME;
  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const osMod = await import("node:os");

  const tempDir = await fs.mkdtemp(pathMod.join(osMod.tmpdir(), "open-coordinator-state-"));
  process.env.XDG_CONFIG_HOME = tempDir;
  return { tempDir, original };
};

export const cleanupTempStateDir = async (tempDir: string, original: string | undefined) => {
  if (original === undefined) {
    process.env.XDG_CONFIG_HOME = undefined;
  } else {
    process.env.XDG_CONFIG_HOME = original;
  }
  const fs = await import("node:fs/promises");
  await fs.rm(tempDir, { recursive: true, force: true });
};
