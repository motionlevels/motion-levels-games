import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameCard } from "../src/catalog.ts";
import { migrateLegacyLevelState, type MigratableLevelState } from "../src/levelStateMigration.ts";

const gameID = "c1daea4f-e586-4116-8cbe-871cde887a81";
const levelOne = {
  easy: "96b8403a-d5eb-41e8-b925-5afc3e2d7e41",
  medium: "ab3425b4-9740-4cdd-a0a1-3a803a8d5c0c",
  hard: "1e8f92d81fb73b591f0f1f6f72269cf5d9f2309a",
};
const levelTwo = {
  easy: "55bd3d1a3fef49a796a70d44c96cc925",
  medium: "bc0c1cd419323eba850249520172349d3477b012",
  hard: "d".repeat(64),
};

const parkour: GameCard = {
  id: gameID,
  engineGame: "parkour-renamed",
  sourceKind: "platform_levels",
  label: "Parkour",
  category: "individual",
  color: "#ff9f45",
  players: "1",
  difficulty: "Fácil-Difícil",
  duration: "",
  mode: "Niveles",
  audio: "Música + efectos",
  description: "",
  rules: [],
  difficulties: ["easy", "medium", "hard"],
  levels: [
    { id: levelOne.easy, slug: "parkour-uno", canonicalIdsByDifficulty: levelOne, label: "Uno", description: "", difficulties: ["easy", "medium", "hard"] },
    { id: levelTwo.easy, slug: "parkour-dos", canonicalIdsByDifficulty: levelTwo, label: "Dos", description: "", difficulties: ["easy", "medium", "hard"] },
  ],
};

describe("legacy level state migration", () => {
  it("preserves a realistic kiosk state while moving slug keys to per-difficulty canonical ids", () => {
    const preUpgrade: MigratableLevelState = {
      difficulty: "medium",
      selectedLevels: { [gameID]: "parkour-dos", "missing-game": "legacy-level" },
      levelProgress: {
        [gameID]: {
          unlockedThrough: 3,
          bestByLevel: {
            "parkour-uno": "hard",
            [levelOne.hard]: "medium",
            "retired-level": "easy",
          },
          bestTimeByLevel: {
            "parkour-uno": 42_000,
            [levelOne.hard]: 45_000,
            "retired-level": 13_000,
            "time-without-best-entry": 8_000,
          },
        },
      },
      challengeRuns: {
        [gameID]: {
          difficulty: "medium",
          startedUnixMillis: 1_700_000_000_000,
          completedLevels: {
            "parkour-uno": 12_000,
            [levelOne.medium]: 15_000,
            "retired-level": 9_000,
          },
          totalElapsedMillis: 36_000,
          attemptCount: 4,
        },
      },
    };

    const migrated = migrateLegacyLevelState(preUpgrade, [parkour]);

    assert.equal(migrated.selectedLevels[gameID], levelTwo.medium);
    assert.equal(migrated.selectedLevels["missing-game"], "legacy-level");
    assert.deepEqual(migrated.levelProgress[gameID].bestByLevel, {
      [levelOne.hard]: "hard",
      "retired-level": "easy",
    });
    assert.deepEqual(migrated.levelProgress[gameID].bestTimeByLevel, {
      [levelOne.hard]: 42_000,
      "retired-level": 13_000,
      "time-without-best-entry": 8_000,
    });
    assert.deepEqual(migrated.challengeRuns[gameID].completedLevels, {
      [levelOne.medium]: 12_000,
      "retired-level": 9_000,
    });
    assert.equal(migrated.challengeRuns[gameID].totalElapsedMillis, 21_000);
    assert.equal(migrated.challengeRuns[gameID].attemptCount, 4);
    assert.strictEqual(migrateLegacyLevelState(migrated, [parkour]), migrated);
  });
});
