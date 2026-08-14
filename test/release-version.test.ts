import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveGamesBuildIdentity,
  resolveGamesBuildIdentity
} from "../scripts/build-version.ts";
import { nextReleaseTag } from "../scripts/next-release-tag.ts";

const sourceRevision = "abcdef1234567890abcdef1234567890abcdef12";

test("major releases advance the bundle contract and reset lower versions", () => {
  assert.equal(nextReleaseTag("games-v1.9.0", "major"), "games-v2.0.0");
});

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
    () => nextReleaseTag("games-v1.3.0", "breaking" as "patch"),
    /Unsupported release change/
  );
});

test("tagged builds expose the canonical version without weakening their source revision", () => {
  assert.deepEqual(
    deriveGamesBuildIdentity(sourceRevision, { explicitReleaseTag: "games-v2.0.3" }),
    {
      sourceRevision,
      buildVersion: "v2.0.3",
      releaseTag: "games-v2.0.3"
    }
  );
});

test("untagged builds expose exactly the first six source revision characters", () => {
  assert.deepEqual(deriveGamesBuildIdentity(sourceRevision), {
    sourceRevision,
    buildVersion: "abcdef",
    releaseTag: null
  });
});

test("the highest canonical exact tag wins without losing numeric precision", () => {
  assert.deepEqual(
    deriveGamesBuildIdentity(sourceRevision, {
      exactReleaseTags: [
        "v999.0.0",
        "games-v2.0.9",
        "games-v2.0.10",
        "games-v9007199254740993.2.4",
        "games-v9007199254740993.2.5",
        "games-v9007199254740993.2.5-rc.1"
      ]
    }),
    {
      sourceRevision,
      buildVersion: "v9007199254740993.2.5",
      releaseTag: "games-v9007199254740993.2.5"
    }
  );
});

test("the explicit release-tag environment override takes precedence over inferred tags", () => {
  assert.deepEqual(
    resolveGamesBuildIdentity(sourceRevision, {
      cwd: "/path/that/does/not/need/to/exist",
      environment: { MOTION_LEVELS_GAMES_RELEASE_TAG: "games-v3.4.5" }
    }),
    {
      sourceRevision,
      buildVersion: "v3.4.5",
      releaseTag: "games-v3.4.5"
    }
  );
});

test("build identity rejects noncanonical explicit tags and non-full source revisions", () => {
  for (const releaseTag of [
    "v2.0.3",
    "games-v02.0.3",
    "games-v2.0",
    "games-v2.0.3-rc.1",
    " games-v2.0.3"
  ]) {
    assert.throws(
      () => deriveGamesBuildIdentity(sourceRevision, { explicitReleaseTag: releaseTag }),
      /invalid games release tag/
    );
  }
  for (const revision of [sourceRevision.slice(0, 39), sourceRevision.toUpperCase(), `${sourceRevision}0`]) {
    assert.throws(() => deriveGamesBuildIdentity(revision), /invalid games source revision/);
  }
});
