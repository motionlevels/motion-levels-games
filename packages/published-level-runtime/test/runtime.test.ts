import assert from "node:assert/strict";
import test from "node:test";
import type { GameManifest } from "@motion-levels-games/game-sdk";
import { normalizeGameContent } from "@motion-levels-games/game-sdk";

import {
  createPublishedLevelContent,
  createPublishedLevelGame,
  createPublishedLevelSessionController,
  parsePublishedLevelContent,
  type PublishedLevelSessionControllerObservation,
  type PublishedLevelProduct
} from "../src/index.ts";

const gameId = "00000000-0000-4000-8000-000000000001";
const engineGame = "runtime-test-levels";
const manifest: GameManifest = {
  id: gameId,
  slug: engineGame,
  aliases: [engineGame],
  label: "Niveles de prueba",
  availability: { development: true, production: false },
  catalog: {
    category: "team",
    color: "#35d7ff",
    durationLabel: "Por nivel",
    modeLabel: "Niveles",
    audioLabel: "Efectos",
    rules: ["Recoge los objetivos"]
  },
  players: { allowAny: false, min: 1, max: 2 },
  start: { mode: "immediate" },
  config: { difficulty: { default: "medium", options: ["easy", "medium", "hard"] }, vars: [] },
  defaultDurationMillis: 0,
  display: { entry: "./display" },
  preview: { seed: 137, playerCount: 1, actions: [], captureStartMillis: 3_100, frameCount: 1, frameIntervalMillis: 20 }
};

test("content is deeply validated, immutable, revisioned, and canonical-id-bound", () => {
  const content = testContent();
  assert.equal(content.gameId, gameId);
  assert.equal(content.engineGame, engineGame);
  assert.equal(content.selectedLevelId, "33333333-3333-4333-8333-333333333301");
  assert.equal(content.selectedLevelSlug, "level-1");
  assert.match(content.contentRevision, /^[0-9a-f]{16}$/);
  assert.ok(Object.isFrozen(content));
  assert.ok(Object.isFrozen(content.levels));
  assert.ok(Object.isFrozen(content.levels[0]?.frames[0]?.c));

  const platformRevision = "0123456789abcdef".repeat(4);
  assert.equal(createPublishedLevelContent({
    gameId,
    engineGame,
    contentRevision: platformRevision,
    levelsPayload: content.levels
  }).contentRevision, platformRevision, "a host-supplied SHA-256 revision is preserved exactly");
  for (const invalidRevision of [
    "not-a-hash",
    "0123456789ABCDEf",
    "0123456789abcde",
    " 0123456789abcdef ",
    "a".repeat(65)
  ]) {
    assert.throws(() => createPublishedLevelContent({
      gameId,
      engineGame,
      contentRevision: invalidRevision,
      levelsPayload: content.levels
    }), /contentRevision/);
  }

  const cloned = normalizeGameContent(content);
  assert.ok(cloned);
  assert.equal(parsePublishedLevelContent(cloned, gameId, [engineGame]).contentRevision, content.contentRevision);
  assert.throws(() => parsePublishedLevelContent(cloned, "00000000-0000-4000-8000-000000000002", [engineGame]), /expected/);
  assert.equal(
    parsePublishedLevelContent(cloned, gameId, ["release-time-old-alias"]).engineGame,
    engineGame,
    "release-time aliases do not participate in canonical identity"
  );
  const renamed = createPublishedLevelContent({
    gameId,
    engineGame: "runtime-levels-renamed",
    levelsPayload: content.levels
  });
  assert.equal(
    parsePublishedLevelContent(renamed, gameId, [engineGame]).engineGame,
    "runtime-levels-renamed"
  );
  for (const invalidEngineGame of ["", 42, null]) {
    assert.throws(() => createPublishedLevelContent({
      gameId,
      engineGame: invalidEngineGame as string,
      levelsPayload: content.levels
    }), /engineGame/);
  }
  assert.throws(() => createPublishedLevelContent({
    gameId: "mutable-game-slug",
    engineGame,
    levelsPayload: content.levels
  }), /canonical UUID or lowercase/);
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    mode: "endless" as "challenge",
    levelsPayload: content.levels
  }), /challenge or free/);
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    levelsPayload: [{
      id: "33333333-3333-4333-8333-333333333399",
      slug: "level-1",
      frames: [{ r: 1, c: [[16, 0, 1, "outside"]] }]
    }]
  }), /through 15/);

  for (const hashLength of [32, 40, 64]) {
    const hashGameId = "a".repeat(hashLength);
    const hashLevelId = "b".repeat(hashLength);
    const hashContent = createPublishedLevelContent({
      gameId: hashGameId,
      engineGame: "hash-game",
      selectedLevelId: hashLevelId,
      levelsPayload: [{
        id: hashLevelId,
        slug: "hash-level",
        frames: [{ r: 1, c: [[1, 1, 1, "goal"]] }]
      }]
    });
    assert.equal(hashContent.gameId, hashGameId);
    assert.equal(hashContent.selectedLevelId, hashLevelId);
    assert.equal(parsePublishedLevelContent(hashContent, hashGameId, []).gameId, hashGameId);
  }
  assert.throws(() => createPublishedLevelContent({
    gameId: "A".repeat(32),
    engineGame,
    levelsPayload: content.levels
  }), /lowercase/);
  assert.throws(() => createPublishedLevelContent({
    gameId: ` ${"a".repeat(32)} `,
    engineGame,
    levelsPayload: content.levels
  }), /canonical representation/);
});

test("nested authored records fail loudly and legacy level aliases must resolve uniquely", () => {
  const base = {
    id: "33333333-3333-4333-8333-333333333351",
    slug: "level-1",
    label: "Válido",
    frames: [{ r: 1, c: [[1, 1, 1, "goal"]] }]
  };
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    levelsPayload: [{ ...base, frames: [] }]
  }), /at least one frame/);
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    levelsPayload: [{ ...base, rules: { victory_condition: "first_player" } }]
  }), /victory_condition/);
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    levelsPayload: [base],
    resultAnimationsPayload: [{
      slug: "bad-color",
      tile_effects: { 1: { color: "blue" } },
      frames: [{ r: 1, c: [[1, 1, 1]] }]
    }]
  }), /six-digit hex color/);
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    selectedLevelId: "level-1",
    levelsPayload: [
      base,
      { ...base, id: "33333333-3333-4333-8333-333333333352" }
    ]
  }), /ambiguous/);
  assert.throws(() => createPublishedLevelContent({
    gameId,
    engineGame,
    levelsPayload: [base, { ...base, slug: "level-2" }]
  }), /duplicate canonical level id/);

  const canonical = createPublishedLevelContent({
    gameId,
    engineGame,
    selectedLevelId: "33333333-3333-4333-8333-333333333352",
    selectedLevelSlug: "nivel 1",
    levelsPayload: [
      base,
      { ...base, id: "33333333-3333-4333-8333-333333333352" }
    ]
  });
  assert.equal(canonical.selectedLevelId, "33333333-3333-4333-8333-333333333352");
  assert.equal(canonical.selectedLevelSlug, "level-1");
});

test("blue area capture, purple double press, damage cooldown, and level advance match niveles", () => {
  const game = createTestGame();
  game.init(0);
  assert.equal(game.snapshot().phase, "countdown");
  game.tick({ atMillis: 1_500 });
  assert.ok(game.render().cells.some((cell) => cell.color !== "#000000"));

  game.tick({ atMillis: 3_000 });
  game.press({ x: 2, y: 2, pressed: true, atMillis: 3_020 });
  assert.equal(game.snapshot().score, 2, "one press captures the connected blue platform");

  game.press({ x: 12, y: 12, pressed: true, atMillis: 3_040 });
  assert.equal(game.snapshot().lives, 2);
  game.release({ x: 12, y: 12, pressed: false, atMillis: 3_060 });
  game.press({ x: 12, y: 12, pressed: true, atMillis: 3_080 });
  assert.equal(game.snapshot().lives, 2, "the same red tile has a one-second cooldown");

  game.press({ x: 8, y: 8, pressed: true, atMillis: 3_100 });
  assert.equal(game.snapshot().score, 2, "the first purple press only holds the objective");
  game.release({ x: 8, y: 8, pressed: false, atMillis: 3_120 });
  game.press({ x: 8, y: 8, pressed: true, atMillis: 3_140 });
  assert.equal(game.snapshot().score, 8, "the second purple press captures it and collect_all adds pass_score");

  game.tick({ atMillis: 3_160 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().score, 8, "pass_score is added only once");
  game.tick({ atMillis: 4_411 });
  assert.equal(game.snapshot().phase, "countdown");
  assert.equal(game.snapshot().level, "33333333-3333-4333-8333-333333333302");
  assert.equal(game.snapshot().levelSlug, "level-2");
  assert.equal(game.snapshot().score, 0);
});

test("failed levels restart immediately after the legacy three-second result", () => {
  const content = createPublishedLevelContent({
    gameId,
    engineGame,
    levelsPayload: [{
      id: "33333333-3333-4333-8333-333333333301",
      slug: "level-1",
      label: "Sin vidas",
      life: 1,
      frames: [{ r: 100, c: [[1, 1, 2, "red"], [5, 5, 1, "goal"]] }]
    }]
  });
  const game = createPublishedLevelGame({ manifest, fallbackContent: content }, {});
  game.init(0);
  game.tick({ atMillis: 3_000 });
  game.press({ x: 1, y: 1, pressed: true, atMillis: 3_020 });
  assert.equal(game.snapshot().phase, "finished");
  game.tick({ atMillis: 6_019 });
  assert.equal(game.snapshot().phase, "finished");
  game.tick({ atMillis: 6_020 });
  assert.equal(game.snapshot().phase, "running");
  assert.equal(game.snapshot().countdownMillis, 0);
  assert.equal(game.snapshot().lives, 1);
  game.tick({ atMillis: 6_021 });
  assert.equal(game.snapshot().phase, "finished", "the still-held physical foot is re-evaluated after retry");
  assert.equal(game.snapshot().lives, 0);
});

test("semantic Jugar controllers reserve distinct objectives and return planned paths", () => {
  const game = createTestGame(2);
  game.init(0);
  game.tick({ atMillis: 3_000 });
  const avatars = [avatar(0, 0, 6, 28), avatar(1, 1, 9, 28)];
  const first = createPublishedLevelSessionController({
    id: "first",
    seed: 137,
    playerIndex: 0,
    game,
    manifest
  });
  const second = createPublishedLevelSessionController({
    id: "second",
    seed: 137,
    playerIndex: 1,
    game,
    manifest
  });
  const common = {
    tick: 150,
    atMillis: 3_000,
    deltaMillis: 20,
    gameId,
    game,
    frame: game.render(),
    snapshot: game.snapshot(),
    avatars
  };
  const firstResult = first.step({ ...common, self: avatars[0]! } satisfies PublishedLevelSessionControllerObservation);
  const secondResult = second.step({ ...common, self: avatars[1]! } satisfies PublishedLevelSessionControllerObservation);
  assert.equal(firstResult?.action?.kind, "move");
  assert.equal(secondResult?.action?.kind, "move");
  assert.notDeepEqual(firstResult?.action?.target, secondResult?.action?.target);
  assert.ok((firstResult?.action?.path?.length ?? 0) > 0);
  first.dispose?.();
  second.dispose?.();
});

function createTestGame(playerCount = 1) {
  const product: PublishedLevelProduct = { manifest, fallbackContent: testContent() };
  return createPublishedLevelGame(product, { playerCount, difficulty: "medium" });
}

function testContent() {
  const rules = {
    victory_condition: "collect_all",
    difficulty_settings: {
      easy: { life: 4 },
      medium: { life: 3 },
      hard: { life: 2 }
    },
    green_platform_load_animation: true,
    blue_platform_capture_area: true
  };
  const frame = {
    r: 100,
    c: [
      [6, 28, 0, "safe-a"],
      [9, 28, 0, "safe-b"],
      [2, 2, 1, "blue-a"],
      [3, 2, 1, "blue-b"],
      [8, 8, 3, "purple"],
      [12, 12, 2, "red"]
    ]
  };
  return createPublishedLevelContent({
    gameId,
    engineGame,
    selectedLevelId: "level-1",
    levelsPayload: [
      {
        id: "33333333-3333-4333-8333-333333333301",
        slug: "level-1",
        label: "Nivel 1",
        pass_score: 5,
        rules,
        frames: [frame]
      },
      {
        id: "33333333-3333-4333-8333-333333333302",
        slug: "level-2",
        label: "Nivel 2",
        pass_score: 5,
        rules,
        frames: [frame]
      }
    ]
  });
}

function avatar(id: number, playerIndex: number, x: number, y: number) {
  return {
    id,
    playerIndex,
    isBot: true,
    color: "#35d7ff",
    position: { x, y },
    tile: { x, y },
    pressedTile: null,
    target: null,
    speed: 3,
    jumpStartedAt: 0,
    airborneUntil: 0,
    stepCount: 0,
    zoneIndex: null
  };
}
