import assert from "node:assert/strict";
import test from "node:test";

import { nextReleaseTag } from "../scripts/next-release-tag.ts";

test("minor releases advance the catalog version and reset the patch", () => {
  assert.equal(nextReleaseTag("games-v1.3.7", "minor"), "games-v1.4.0");
});

test("patch releases preserve the catalog version", () => {
  assert.equal(nextReleaseTag("games-v1.3.7", "patch"), "games-v1.3.8");
  assert.equal(nextReleaseTag("games-v1.3.9", "patch"), "games-v1.3.10");
  assert.equal(nextReleaseTag("games-v0.0.0", "patch"), "games-v0.0.1");
});

test("release versions do not silently lose precision", () => {
  assert.equal(
    nextReleaseTag("games-v9007199254740993.2.4", "patch"),
    "games-v9007199254740993.2.5"
  );
});

test("release tags and change types are strict", () => {
  assert.throws(() => nextReleaseTag("v1.3.0", "patch"), /Invalid games release tag/);
  assert.throws(() => nextReleaseTag("games-v01.3.0", "patch"), /Invalid games release tag/);
  assert.throws(() => nextReleaseTag("games-v1.3.0-rc.1", "patch"), /Invalid games release tag/);
  assert.throws(() => nextReleaseTag("games-v1.3.0+build", "patch"), /Invalid games release tag/);
  assert.throws(
    () => nextReleaseTag("games-v1.3.0", "major" as "patch"),
    /Unsupported release change/
  );
});
