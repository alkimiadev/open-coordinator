import { expect, test } from "bun:test";

import { unwrapSdkResponse } from "../src/sdk";

test("unwrapSdkResponse returns data from envelope", () => {
  const result = unwrapSdkResponse<{ id: string }>({ data: { id: "abc" } }, "Test");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.id).toBe("abc");
});

test("unwrapSdkResponse returns error from envelope", () => {
  const result = unwrapSdkResponse({ error: "boom" }, "Test");
  expect(result.ok).toBe(false);
});

test("unwrapSdkResponse errors when data is missing", () => {
  const result = unwrapSdkResponse({}, "Test");
  expect(result.ok).toBe(false);
});
