import assert from "node:assert/strict";
import test from "node:test";
import { reportDisplayError } from "../src/displayError.ts";

test("player display render errors are reported asynchronously", async () => {
  const failure = new Error("display failed");
  let reported: unknown;
  reportDisplayError((reason) => { reported = reason; }, failure);
  assert.equal(reported, undefined);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(reported, failure);
});

test("player display errors are ignored without a host callback", () => {
  assert.doesNotThrow(() => reportDisplayError(undefined, new Error("display failed")));
});
