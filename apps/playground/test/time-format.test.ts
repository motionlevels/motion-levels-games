import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsedClock } from "../src/timeFormat.ts";

test("formats elapsed time with a stable centisecond clock", () => {
  assert.equal(formatElapsedClock(0), "00:00:00.00");
  assert.equal(formatElapsedClock(48_230), "00:00:48.23");
  assert.equal(formatElapsedClock(3_723_459), "01:02:03.45");
});

test("clamps invalid and negative elapsed times", () => {
  assert.equal(formatElapsedClock(-1), "00:00:00.00");
  assert.equal(formatElapsedClock(Number.NaN), "00:00:00.00");
});
