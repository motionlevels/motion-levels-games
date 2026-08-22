import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORED_GAME_SOURCE_SCHEMA,
  type AuthoredGameSourceManifest,
  createRepositoryAuthoredLevelContent,
  validateAuthoredGameSourceManifest
} from "../src/index.ts";

const sourceManifest: AuthoredGameSourceManifest = {
  schema: AUTHORED_GAME_SOURCE_SCHEMA,
  gameId: "00000000-0000-4000-8000-000000000001",
  engineGame: "source-adapter-test",
  difficulties: ["medium"],
  defaultDifficulty: "medium",
  defaultMode: "challenge",
  defaultLevelSlug: "level-1",
  resultAnimationIds: []
};

test("source manifests canonicalize result animation ids at the repository boundary", () => {
  const uuid = "f72daac4-27a5-4144-b143-a6a85a34c3ec";
  const hash = "a".repeat(64);
  const normalized = validateAuthoredGameSourceManifest({
    ...sourceManifest,
    resultAnimationIds: [`  ${uuid.toUpperCase()}  `, uuid, " ", hash]
  });

  assert.deepEqual(normalized.resultAnimationIds, [hash, uuid]);
  assert.ok(Object.isFrozen(normalized.resultAnimationIds));

  const { resultAnimationIds: _omitted, ...manifestWithoutAnimationIds } = sourceManifest;
  assert.deepEqual(validateAuthoredGameSourceManifest(
    manifestWithoutAnimationIds as AuthoredGameSourceManifest
  ).resultAnimationIds, []);

  assert.throws(() => validateAuthoredGameSourceManifest({
    ...sourceManifest,
    resultAnimationIds: ["win-animation"]
  }), /resultAnimationIds contains invalid stable id win-animation/);
});

test("repository-authored content is ordered and selects the manifest default", () => {
  const firstLevelId = "33333333-3333-4333-8333-333333333301";
  const secondLevelId = "33333333-3333-4333-8333-333333333302";
  const content = createRepositoryAuthoredLevelContent({
    game: sourceManifest,
    levels: [
      {
        id: secondLevelId,
        slug: "level-2",
        difficulty: "medium",
        sort_order: 20,
        frames: [{ r: 1, c: [[2, 2, 1, "second-goal"]] }]
      },
      {
        id: firstLevelId,
        slug: "level-1",
        difficulty: "medium",
        sort_order: 10,
        frames: [{ r: 1, c: [[1, 1, 1, "first-goal"]] }]
      }
    ],
    resultAnimations: [],
    contentRevision: "0123456789abcdef"
  });

  assert.deepEqual(content.levels.map((level) => level.id), [firstLevelId, secondLevelId]);
  assert.equal(content.selectedLevelId, firstLevelId);
  assert.equal(content.selectedLevelSlug, "level-1");
  assert.equal(content.contentRevision, "0123456789abcdef");
  assert.ok(Object.isFrozen(content));
});
