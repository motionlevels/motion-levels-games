import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const dev = await readFile(new URL("../.github/workflows/dev-games.yml", import.meta.url), "utf8");
const checks = await readFile(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8");

test("main and dev workflows share one CI implementation", () => {
  assert.match(ci, /uses: \.\/\.github\/workflows\/checks\.yml/);
  assert.match(dev, /uses: \.\/\.github\/workflows\/checks\.yml/);
  assert.doesNotMatch(ci, /npm (?:ci|run|test)/, "the caller must not duplicate reusable CI steps");
  assert.doesNotMatch(dev, /npm (?:ci|run|test)/, "the dev caller must only add its branch policy");
});

test("CI cancels stale runs and uses least-privilege permissions", () => {
  for (const [name, workflow] of [["CI", ci], ["Dev Games CI", dev]] as const) {
    assert.match(workflow, /permissions:\s*\n\s+contents: read/);
    assert.match(workflow, /concurrency:[\s\S]*?cancel-in-progress: true/);
    assert.match(workflow, /workflow_dispatch:/, `${name} must remain manually runnable`);
  }
});

test("reusable CI separates quality, compatibility, coverage, and runtime checks", () => {
  assert.match(checks, /workflow_call:/);
  for (const job of ["quality", "compatibility-tests", "coverage-tests", "build-and-playtest"]) {
    assert.match(checks, new RegExp(`^  ${job}:`, "m"), `${job} must remain an independent job`);
  }
  assert.match(checks, /node-version: 22/);
  assert.match(checks, /node-version: 24/);
  assert.match(checks, /run: npm run test:coverage/);
  assert.match(checks, /run: npm run test:contracts/);
  assert.match(checks, /run: npm run playtest/);
  assert.equal((checks.match(/timeout-minutes:/g) ?? []).length, 4, "every reusable job needs a timeout");
});
