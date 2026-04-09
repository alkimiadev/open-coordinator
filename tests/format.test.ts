import { expect, test } from "bun:test";

import { formatCommand } from "../src/format";

test("formatCommand quotes arguments safely", () => {
  expect(formatCommand(["git", "status", "--porcelain"])).toBe("git status --porcelain");
  expect(formatCommand(["git", "commit", "-m", "hello world"])).toBe("git commit -m 'hello world'");
  expect(formatCommand(["git", "tag", "feat's"])).toBe("git tag 'feat'\"'\"'s'");
});
