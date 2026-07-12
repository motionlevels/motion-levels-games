import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const dev = await readFile(new URL("../.github/workflows/dev-games.yml", import.meta.url), "utf8");
const checks = await readFile(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8");
const release = await readFile(new URL("../.github/workflows/release-bundle.yml", import.meta.url), "utf8");

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

test("release tags pass the shared quality gate and identify current main exactly", () => {
  assert.match(release, /^\s{2}release-policy:/m);
  assert.match(release, /\^games-v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assert.match(release, /git fetch --no-tags origin main/);
  assert.match(release, /git rev-list -n 1 "\$GITHUB_REF_NAME"/);
  assert.match(release, /test "\$source_revision" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(release, /^\s{2}checks:[\s\S]*?uses: \.\/\.github\/workflows\/checks\.yml/m);
  assert.match(release, /^\s{2}bundle:[\s\S]*?needs:[\s\S]*?- release-policy[\s\S]*?- checks/m);
  assert.match(release, /MOTION_LEVELS_GAMES_SOURCE_REVISION: \$\{\{ env\.SOURCE_REVISION \}\}/);
});

test("published release assets are immutable and dispatch their exact identity to the platform", () => {
  assert.match(release, /overwrite_files: false/);
  assert.match(release, /target_commitish: \$\{\{ env\.SOURCE_REVISION \}\}/);
  assert.match(release, /secrets\.PLATFORM_SYNC_TOKEN/);
  assert.match(release, /test -n "\$PLATFORM_SYNC_TOKEN"/);
  assert.match(release, /ref:\$ref,inputs:\{release_tag:\$release_tag,source_revision:\$source_revision\}/);
  assert.match(release, /repos\/motionlevels\/motion-levels-platform\/actions\/workflows\/sync-games-bundle\.yml\/dispatches/);
  assert.match(release, /cancel-in-progress: false/);
});
