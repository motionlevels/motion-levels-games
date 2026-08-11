import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DifficultyID, GameCard } from "../src/catalog.ts";
import {
  closestLevelIDForDifficulty,
  defaultLevelIDForDifficulty,
  levelsForDifficulty,
  levelSupportsDifficulty,
  normalizedDifficultyForGame,
  selectableDifficultiesForGame,
} from "../src/levelSelection.ts";

function levelGame(patch: Partial<GameCard> = {}): GameCard {
  return {
    id: "parkour",
    label: "Parkour",
    category: "individual",
    color: "#ff9f45",
    players: "1",
    difficulty: "Facil-Dificil",
    duration: "",
    mode: "Niveles",
    audio: "Musica + efectos",
    description: "",
    rules: [],
    allowDifficultyWithLevels: true,
    difficulties: ["easy", "medium", "hard"],
    levels: [
      { id: "level-1", label: "Nivel 1", description: "", difficulties: ["easy", "medium", "hard"] },
      { id: "level-2", label: "Nivel 2", description: "", difficulties: ["medium", "hard"] },
      { id: "level-3", label: "Nivel 3", description: "", difficulties: ["easy"] },
      { id: "level-4", label: "Nivel 4", description: "", difficulties: ["easy"] },
    ],
    ...patch,
  };
}

describe("level difficulty selection", () => {
  it("exposes only difficulties with playable levels", () => {
    const game = levelGame({ difficulties: ["easy", "medium", "hard", "expert"] });

    assert.deepEqual(selectableDifficultiesForGame(game), ["easy", "medium", "hard"]);
    assert.equal(normalizedDifficultyForGame(game, "expert"), "hard");
  });

  it("filters levels by difficulty while preserving authored order", () => {
    const game = levelGame();

    assert.deepEqual(levelsForDifficulty(game, "easy").map((level) => level.id), ["level-1", "level-3", "level-4"]);
    assert.deepEqual(levelsForDifficulty(game, "medium").map((level) => level.id), ["level-1", "level-2"]);
    assert.deepEqual(levelsForDifficulty(game, "hard").map((level) => level.id), ["level-1", "level-2"]);
  });

  it("moves stale level selections to the closest available level when difficulty changes", () => {
    const game = levelGame();

    assert.equal(closestLevelIDForDifficulty(game, "level-4", "medium"), "level-2");
    assert.equal(closestLevelIDForDifficulty(game, "level-2", "easy"), "level-3");
    assert.equal(closestLevelIDForDifficulty(game, "level-1", "hard"), "level-1");
    assert.equal(defaultLevelIDForDifficulty(game, "hard"), "level-1");
  });

  it("migrates a persisted mutable slug to the canonical level UUID", () => {
    const easyID = "96b8403a-d5eb-41e8-b925-5afc3e2d7e41";
    const mediumID = "ab3425b4-9740-4cdd-a0a1-3a803a8d5c0c";
    const game = levelGame({
      difficulties: ["easy", "medium"],
      levels: [
        {
          id: easyID,
          slug: "parkour-principiante",
          canonicalIdsByDifficulty: { easy: easyID, medium: mediumID },
          label: "Principiante",
          description: "",
          difficulties: ["easy", "medium"],
        },
      ],
    });

    assert.equal(closestLevelIDForDifficulty(game, "parkour-principiante", "medium"), mediumID);
    assert.equal(closestLevelIDForDifficulty(game, easyID, "medium"), mediumID);
    assert.equal(defaultLevelIDForDifficulty(game, "medium"), mediumID);
  });

  it("prefers the nearest level in authored order over later matches", () => {
    const game = levelGame({
      difficulties: ["easy", "medium"],
      levels: [
        { id: "level-1", label: "Nivel 1", description: "", difficulties: ["medium"] },
        { id: "level-2", label: "Nivel 2", description: "", difficulties: ["easy"] },
        { id: "level-3", label: "Nivel 3", description: "", difficulties: ["medium"] },
        { id: "level-4", label: "Nivel 4", description: "", difficulties: ["medium"] },
        { id: "level-5", label: "Nivel 5", description: "", difficulties: ["easy"] },
      ],
    });

    // level-3 sits next to level-2; a naive index mapping would jump to level-5.
    assert.equal(closestLevelIDForDifficulty(game, "level-3", "easy"), "level-2");
    assert.equal(closestLevelIDForDifficulty(game, "level-4", "easy"), "level-5");
  });

  it("treats levels without explicit metadata as available for every game difficulty", () => {
    const game = levelGame({
      difficulties: ["medium", "hard"],
      levels: [
        { id: "level-1", label: "Nivel 1", description: "" },
        { id: "level-2", label: "Nivel 2", description: "" },
      ],
    });

    assert.deepEqual(selectableDifficultiesForGame(game), ["medium", "hard"]);
    assert.deepEqual(levelsForDifficulty(game, "hard").map((level) => level.id), ["level-1", "level-2"]);
    assert.equal(levelSupportsDifficulty(game, game.levels?.[0], "medium" as DifficultyID), true);
  });
});
