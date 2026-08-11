import assert from "node:assert/strict";
import test from "node:test";
import {
  createGameEngine,
  frameCell,
  type GameConfig,
  type GameManifest
} from "@motion-levels-games/game-sdk";

import {
  createPublishedLevelContent,
  createPublishedLevelGame,
  type PublishedLevelContent,
  type PublishedLevelProduct,
  type PublishedLevelSnapshot
} from "../src/index.ts";

const gameId = "00000000-0000-4000-8000-000000000011";
const engineGame = "niveles-parity";
const firstLevelId = "44444444-4444-4444-8444-444444444401";
const secondLevelId = "44444444-4444-4444-8444-444444444402";
const manifest: GameManifest = {
  id: gameId,
  slug: engineGame,
  aliases: [engineGame],
  label: "Paridad de niveles",
  availability: { development: true, production: false },
  catalog: {
    category: "team",
    color: "#35d7ff",
    durationLabel: "Por nivel",
    modeLabel: "Niveles",
    audioLabel: "Audio publicado",
    rules: ["Respeta el nivel publicado"]
  },
  players: { allowAny: false, min: 1, max: 6 },
  start: { mode: "immediate" },
  config: { difficulty: { default: "medium", options: ["medium"] }, vars: [] },
  defaultDurationMillis: 0,
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 1,
    actions: [],
    captureStartMillis: 3_000,
    frameCount: 1,
    frameIntervalMillis: 20
  }
};

test("25ms authored frames remain exact under a 20ms authority and held feet re-evaluate moving red", () => {
  const content = makeContent([{
    id: firstLevelId,
    slug: "level-1",
    label: "Cadencia exacta",
    life: 3,
    frame_tick_ms: 25,
    frames: [
      { r: 1, c: [[4, 4, 0, "moving"], [10, 10, 1, "goal"]] },
      { r: 1, c: [[4, 4, 2, "moving"], [10, 10, 1, "goal"]] }
    ]
  }]);
  const game = makeGame(content);
  game.init(0);
  game.tick({ atMillis: 3_000 });
  assert.equal(frameCell(game.render(), 4, 4)?.color, "#00ff48");
  assert.deepEqual(game.press({ x: 4, y: 4, pressed: true, atMillis: 3_000 }), []);

  game.tick({ atMillis: 3_020 });
  assert.equal(game.snapshot().lives, 3);
  assert.equal(frameCell(game.render(), 4, 4)?.color, "#00ff48", "20ms does not round a 25ms frame down");

  const events = game.tick({ atMillis: 3_025 });
  assert.equal(game.semanticTiles().find((tile) => tile.x === 4 && tile.y === 4)?.kind, 2);
  assert.equal(frameCell(game.render(), 4, 4)?.color, "#ffec52", "damage flash confirms the exact red transition");
  assert.equal(game.snapshot().lives, 2, "a stationary held foot is damaged when red moves underneath");
  assert.equal(events[0]?.cue, "damage");
});

test("red damage is per-coordinate by default and optionally shares a global grace period", () => {
  const level = {
    id: firstLevelId,
    slug: "level-1",
    label: "Daño rojo",
    life: 5,
    frames: [{ r: 100, c: [[4, 4, 2, "red-a"], [5, 4, 2, "red-b"], [10, 10, 1, "goal"]] }]
  };
  const noMercy = makeGame(makeContent([level]));
  noMercy.init(0);
  noMercy.tick({ atMillis: 3_000 });
  noMercy.press({ x: 4, y: 4, pressed: true, atMillis: 3_010 });
  noMercy.press({ x: 5, y: 4, pressed: true, atMillis: 3_010 });
  assert.equal(noMercy.snapshot().lives, 3, "different red coordinates can damage in the same instant");
  noMercy.release({ x: 4, y: 4, pressed: false, atMillis: 3_050 });
  noMercy.press({ x: 4, y: 4, pressed: true, atMillis: 3_100 });
  assert.equal(noMercy.snapshot().lives, 3, "the same coordinate retains its one-second cooldown");

  const grace = makeGame(makeContent([{ ...level, rules: { red_damage_grace_period: true } }]));
  grace.init(0);
  grace.tick({ atMillis: 3_000 });
  grace.press({ x: 4, y: 4, pressed: true, atMillis: 3_010 });
  grace.press({ x: 5, y: 4, pressed: true, atMillis: 3_100 });
  assert.equal(grace.snapshot().lives, 4, "global grace covers a different red coordinate");
  grace.release({ x: 5, y: 4, pressed: false, atMillis: 3_200 });
  grace.press({ x: 5, y: 4, pressed: true, atMillis: 4_020 });
  assert.equal(grace.snapshot().lives, 3);
});

test("the default left countdown enters from the near floor edge and settles exactly", () => {
  const game = makeGame(makeContent([{
    id: firstLevelId,
    slug: "level-1",
    label: "Entrada izquierda",
    frames: [{ r: 100, c: [[5, 28, 0, "safe"], [10, 10, 1, "goal"]] }]
  }]));
  game.init(0);

  game.tick({ atMillis: 1_500 });
  assert.notEqual(frameCell(game.render(), 5, 31)?.color, "#000000", "the safe tile is visibly entering from below");
  assert.equal(frameCell(game.render(), 5, 28)?.color, "#000000", "it is not painted at its target early");

  game.tick({ atMillis: 2_999 });
  assert.equal(frameCell(game.render(), 5, 28)?.color, "#00ff48");
  assert.equal(frameCell(game.render(), 10, 10)?.color, "#000000", "hazards and objectives stay hidden in countdown");
});

test("success holds for exactly 1250ms, advances by canonical UUID, then starts a fresh countdown", () => {
  const game = makeGame(makeContent([
    {
      id: firstLevelId,
      slug: "level-1",
      label: "Primero",
      frames: [{ r: 100, c: [[4, 4, 1, "goal-a"]] }]
    },
    {
      id: secondLevelId,
      slug: "level-2",
      label: "Segundo",
      frames: [{ r: 100, c: [[5, 28, 0, "safe"], [6, 6, 1, "goal-b"]] }]
    }
  ]));
  game.init(0);
  game.tick({ atMillis: 3_000 });
  game.press({ x: 4, y: 4, pressed: true, atMillis: 3_020 });
  game.tick({ atMillis: 3_020 });

  game.tick({ atMillis: 4_269 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().resultMillis, 1);
  assert.equal(game.snapshot().level, firstLevelId);

  game.tick({ atMillis: 4_270 });
  const next = game.snapshot();
  assert.equal(next.phase, "countdown");
  assert.equal(next.level, secondLevelId);
  assert.equal(next.levelSlug, "level-2");
  assert.equal(next.countdownMillis, 3_000);
  assert.equal(next.attemptCreatedMillis, 4_270);
  assert.equal(next.attemptStartedMillis, 7_270);
});

test("challenge timing, free timing, score_at_least, and collect_all stay distinct", () => {
  const scoreLevel = {
    id: firstLevelId,
    slug: "level-1",
    label: "Condiciones",
    pass_score: 1,
    time_limit_seconds: 1,
    rules: { victory_condition: "score_at_least" },
    frames: [{ r: 100, c: [[4, 4, 1, "a"], [5, 5, 1, "b"]] }]
  };
  const challenge = makeGame(makeContent([scoreLevel], "challenge"));
  challenge.init(0);
  challenge.tick({ atMillis: 3_999 });
  assert.equal(challenge.snapshot().phase, "running");
  assert.equal(challenge.snapshot().remainingMillis, 1);
  challenge.tick({ atMillis: 4_000 });
  assert.equal(challenge.snapshot().phase, "finished");
  assert.equal(challenge.snapshot().success, false);

  const free = makeGame(makeContent([scoreLevel], "free"));
  free.init(0);
  free.tick({ atMillis: 40_000 });
  assert.equal(free.snapshot().phase, "running");
  assert.equal(free.snapshot().remainingMillis, 0);
  free.press({ x: 4, y: 4, pressed: true, atMillis: 40_020 });
  free.tick({ atMillis: 40_020 });
  assert.equal(free.snapshot().success, true);
  assert.equal(free.snapshot().score, 1, "score_at_least does not add a completion bonus");
  assert.equal(free.snapshot().objectivesRemaining, 1);

  const collectAll = makeGame(makeContent([{
    ...scoreLevel,
    pass_score: 5,
    time_limit_seconds: 0,
    rules: { victory_condition: "collect_all" }
  }]));
  collectAll.init(0);
  collectAll.tick({ atMillis: 3_000 });
  collectAll.press({ x: 4, y: 4, pressed: true, atMillis: 3_010 });
  collectAll.tick({ atMillis: 3_010 });
  assert.equal(collectAll.snapshot().phase, "running");
  collectAll.press({ x: 5, y: 5, pressed: true, atMillis: 3_020 });
  collectAll.tick({ atMillis: 3_020 });
  assert.equal(collectAll.snapshot().success, true);
  assert.equal(collectAll.snapshot().score, 7, "collect_all adds pass_score exactly once");
});

test("published result frames and semantic audio cues are deterministic", () => {
  const content = makeContent([{
    id: firstLevelId,
    slug: "level-1",
    label: "Resultado publicado",
    music_ref: "custom/music.mp3",
    music_volume: 0.42,
    narration_cue_ref: "custom/narration.mp3",
    start_cue_ref: "custom/start.mp3",
    coin_cue_ref: "custom/coin.wav",
    double_coin_cue_ref: "custom/double.wav",
    damage_cue_ref: "custom/damage.wav",
    win_cue_ref: "custom/win.wav",
    defeat_cue_ref: "custom/defeat.wav",
    result_animations: { victory_animations: ["published-win"] },
    frames: [{ r: 100, c: [[4, 4, 1, "goal"]] }]
  }], "challenge", [{
    id: "animation-row-id",
    slug: "published-win",
    frame_tick_ms: 50,
    tile_effects: { 1: { color: "#123456" }, 2: { color: "#abcdef" } },
    frames: [{ r: 1, c: [[5, 5, 1]] }, { r: 1, c: [[5, 5, 2]] }]
  }]);
  const first = makeGame(content);
  const second = makeGame(content);
  for (const game of [first, second]) {
    const ready = game.init(0);
    assert.equal(ready[0]?.cue, "ready");
    assert.deepEqual(game.snapshot().audio, {
      musicRef: "custom/music.mp3",
      musicVolume: 0.42,
      narrationCueRef: "custom/narration.mp3",
      startCueRef: "custom/start.mp3",
      coinCueRef: "custom/coin.wav",
      doubleCoinCueRef: "custom/double.wav",
      damageCueRef: "custom/damage.wav",
      winCueRef: "custom/win.wav",
      defeatCueRef: "custom/defeat.wav"
    });
    game.tick({ atMillis: 3_000 });
    assert.deepEqual(
      game.press({ x: 4, y: 4, pressed: true, atMillis: 3_020 }).map((event) => event.cue),
      ["coin", "win"]
    );
    assert.deepEqual(game.tick({ atMillis: 3_020 }), []);
    game.tick({ atMillis: 3_069 });
    assert.equal(frameCell(game.render(), 5, 5)?.color, "#123456");
    game.tick({ atMillis: 3_070 });
    assert.equal(frameCell(game.render(), 5, 5)?.color, "#abcdef");
  }
  assert.deepEqual(first.render(), second.render(), "a fixed end timestamp selects and advances result frames identically");
});

test("GameEngine receives terminal win audio before composing a pure snapshot", () => {
  const content = makeContent([{
    id: firstLevelId,
    slug: "level-1",
    label: "Terminal atómico",
    win_cue_ref: "custom/win.wav",
    frames: [{ r: 100, c: [[4, 4, 1, "goal"]] }]
  }]);
  const game = makeGame(content);
  const initialEvents = game.init(0);
  const engine = createGameEngine(game, { initialEvents, nowMillis: 0, fps: 50 });
  engine.tickTo(3_000);

  const terminal = engine.press(4, 4, 3_020);
  assert.deepEqual(terminal.events.map((event) => event.cue), ["coin", "win"]);
  assert.equal(terminal.snapshot.phase, "finished");
  assert.equal(terminal.snapshot.success, true);
  assert.equal((terminal.snapshot as PublishedLevelSnapshot).audio.winCueRef, "custom/win.wav");
  const firstSnapshot = game.snapshot();
  assert.deepEqual(game.snapshot(), firstSnapshot, "snapshot reads state without advancing authority");
  assert.deepEqual(engine.tickTo(3_020).events, [], "win is emitted exactly once");
});

test("reset keeps one authority while atomically adopting a new live editor revision", () => {
  const first = makeContent([{
    id: firstLevelId,
    slug: "level-1",
    label: "Revisión A",
    frames: [{ r: 100, c: [[4, 4, 1, "a"]] }]
  }], "challenge", [], "a".repeat(64));
  const second = createPublishedLevelContent({
    gameId,
    engineGame,
    contentRevision: "b".repeat(64),
    selectedLevelId: secondLevelId,
    selectedLevelSlug: "renamed-level",
    levelsPayload: [{
      id: secondLevelId,
      slug: "renamed-level",
      label: "Revisión B",
      frames: [{ r: 100, c: [[7, 7, 1, "b"]] }]
    }]
  });
  const game = makeGame(first, { content: first });
  game.init(0);
  const sameAuthority = game;
  game.reset({ nowMillis: 10_000, content: second });
  assert.equal(game, sameAuthority);
  assert.equal(game.snapshot().currentGame, gameId);
  assert.equal(game.snapshot().engineGame, engineGame);
  assert.equal(game.snapshot().contentRevision, "b".repeat(64));
  assert.equal(game.snapshot().level, secondLevelId);
  assert.equal(game.snapshot().levelSlug, "renamed-level");
  assert.equal(game.snapshot().phase, "countdown");
  assert.equal(game.snapshot().attemptCreatedMillis, 10_000);
});

function makeContent(
  levels: unknown[],
  mode: "challenge" | "free" = "challenge",
  resultAnimations: unknown[] = [],
  contentRevision?: string
): PublishedLevelContent {
  return createPublishedLevelContent({
    gameId,
    engineGame,
    contentRevision,
    mode,
    levelsPayload: levels,
    resultAnimationsPayload: resultAnimations
  });
}

function makeGame(content: PublishedLevelContent, config: GameConfig = {}) {
  const product: PublishedLevelProduct = {
    manifest,
    fallbackContent: content
  };
  return createPublishedLevelGame(product, config);
}
