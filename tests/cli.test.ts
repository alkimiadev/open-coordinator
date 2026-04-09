import { expect, test } from "bun:test";

import { parseArgs } from "../src/cli";

test("parseArgs defaults to add", () => {
  const result = parseArgs([]);
  expect("error" in result).toBe(false);
  if ("error" in result) return;
  expect(result.command).toBe("add");
  expect(result.pluginName).toBe("open-coordinator");
  expect(result.dryRun).toBe(false);
});

test("parseArgs handles help", () => {
  const result = parseArgs(["--help"]);
  expect("error" in result).toBe(false);
  if ("error" in result) return;
  expect(result.command).toBe("help");
});

test("parseArgs errors on unknown command", () => {
  const result = parseArgs(["unknown"]);
  expect("error" in result).toBe(true);
});

test("parseArgs errors on missing flag values", () => {
  const configResult = parseArgs(["add", "--config"]);
  expect("error" in configResult).toBe(true);

  const pluginResult = parseArgs(["add", "--plugin"]);
  expect("error" in pluginResult).toBe(true);
});
