export type ToolResult = { ok: true; output: string } | { ok: false; error: string };

export const ok = (output: string): ToolResult => ({ ok: true, output });

export const err = (error: string): ToolResult => ({ ok: false, error });
