import { expect, test } from "bun:test";

import { substituteTemplate } from "../src/worktree-spawn";

test("substituteTemplate replaces {{task}} placeholder", () => {
  expect(substituteTemplate("Task: {{task}}", "auth-setup")).toBe("Task: auth-setup");
  expect(substituteTemplate("Your task: {{task}}. Read docs/{{task}}.md", "feature")).toBe(
    "Your task: feature. Read docs/feature.md",
  );
});

test("substituteTemplate replaces multiple {{task}} occurrences", () => {
  expect(substituteTemplate("{{task}} and {{task}} again", "test")).toBe("test and test again");
});

test("substituteTemplate handles empty template", () => {
  expect(substituteTemplate("", "any-task")).toBe("");
});

test("substituteTemplate handles task without placeholders", () => {
  expect(substituteTemplate("No placeholders here", "task")).toBe("No placeholders here");
});
