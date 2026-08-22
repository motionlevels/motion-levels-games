import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createGameEngine,
  createHorizontalPlayerReadyZones,
  createPlayerReadyGate,
  createFrame,
  createSeededRng,
  defaultGamePlayerCount,
  DEFAULT_GAME_SEED,
  DEFAULT_ENGINE_FPS,
  DEFAULT_ENGINE_FRAME_MILLIS,
  fillFrameRect,
  formatClock,
  frameCell,
  gameEvent,
  gameDifficultyOptions,
  gameMediaAssetSpecs,
  gameMediaFileNames,
  gameMediaMetadataReference,
  gameMediaReferences,
  gameMediaURL,
  gameManifestLookupKeys,
  gameManifestSlug,
  gamePlayerCountOptions,
  inFloorBounds,
  isStableGameId,
  normalizeGameConfig,
  normalizeGameContent,
  normalizeGameConfigOptions,
  normalizeGameConfigValue,
  normalizeGameSeed,
  paintDiamondRing,
  paintDiamondWave,
  readGameConfigOption,
  paintFrameCell,
  rgbToHex,
  sampleSmoothPulse,
  scaleRgb,
  setFrameCell,
  MAX_GAME_SEED,
  type GameConfigVar,
  type GameManifest,
  type GameInstance,
  type PressEvent,
  type TickEvent
} from "../src/index.ts";

const testManifestFields = {
  availability: { development: true, production: false },
  catalog: {
    category: "individual",
    color: "#35d7ff",
    durationLabel: "Test",
    modeLabel: "Test",
    audioLabel: "Sin audio",
    rules: []
  },
  preview: {
    seed: 137,
    playerCount: 1,
    actions: [],
    captureStartMillis: 0,
    frameCount: 1,
    frameIntervalMillis: 20
  }
} as const;

test("game media contract owns dimensions, names, references, and bundle-root URLs", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(gameMediaAssetSpecs).map(([kind, spec]) => [kind, [spec.width, spec.height]])),
    {
      thumbnailSmall: [256, 128],
      thumbnail: [1_024, 512],
      animation: [512, 256],
      playerDisplay: [1_280, 720],
      playerDisplayAnimation: [640, 360]
    }
  );
  assert.deepEqual(gameMediaFileNames(" Hello-World "), {
    thumbnailSmall: "hello-world-thumbnail-small.webp",
    thumbnail: "hello-world-thumbnail.webp",
    animation: "hello-world-preview.webp",
    playerDisplay: "hello-world-player-display.webp",
    playerDisplayAnimation: "hello-world-player-display-animation.webp"
  });
  assert.deepEqual(gameMediaReferences("hello-world"), {
    thumbnailSmall: "media/hello-world/hello-world-thumbnail-small.webp",
    thumbnail: "media/hello-world/hello-world-thumbnail.webp",
    animation: "media/hello-world/hello-world-preview.webp",
    playerDisplay: "media/hello-world/hello-world-player-display.webp",
    playerDisplayAnimation: "media/hello-world/hello-world-player-display-animation.webp"
  });
  assert.equal(gameMediaMetadataReference("hello-world"), "media/hello-world/metadata.json");
  assert.equal(
    gameMediaURL("hello-world", "animation", "https://example.test/games"),
    "https://example.test/games/media/hello-world/hello-world-preview.webp"
  );
  assert.throws(() => gameMediaReferences("../hello-world"));
});

test("stable identities stay separate from renameable game slugs", () => {
  const manifest = {
    ...testManifestFields,
    id: "c1daea4f-e586-4116-8cbe-871cde887a81",
    slug: "parkour-renamed",
    aliases: ["parkour", "parkour-renamed"],
    label: "Parkour",
    players: { allowAny: false, min: 1, max: 1 },
    start: { mode: "immediate" },
    defaultDurationMillis: 1000,
    display: { entry: "./display" }
  } satisfies GameManifest;
  assert.equal(gameManifestSlug(manifest), "parkour-renamed");
  assert.deepEqual(gameManifestLookupKeys(manifest), [
    "c1daea4f-e586-4116-8cbe-871cde887a81",
    "parkour-renamed",
    "parkour"
  ]);
  assert.equal(isStableGameId(manifest.id), true);
  assert.equal(isStableGameId("a".repeat(32)), true);
  assert.equal(isStableGameId("b".repeat(40)), true);
  assert.equal(isStableGameId("c".repeat(64)), true);
  assert.equal(isStableGameId(manifest.id.toUpperCase()), false);
  assert.equal(isStableGameId("A".repeat(32)), false);
  assert.equal(isStableGameId("parkour"), false);
});

test("frame helpers create a fixed 16x32 floor", () => {
  const frame = createFrame("#000000");

  assert.equal(frame.width, FLOOR_COLS);
  assert.equal(frame.height, FLOOR_ROWS);
  assert.equal(frame.cells.length, FLOOR_COLS * FLOOR_ROWS);
  assert.equal(frameCell(frame, 0, 0)?.color, "#000000");
});

test("setFrameCell updates one valid tile and ignores invalid bounds", () => {
  const frame = createFrame("#000000");
  const updated = setFrameCell(frame, 2, 3, "#148cff");
  const ignored = setFrameCell(updated, 99, 99, "#ffffff");

  assert.equal(frameCell(updated, 2, 3)?.color, "#148cff");
  assert.equal(ignored, updated);
});

test("mutable frame helpers paint bounded cells and rectangles", () => {
  const frame = createFrame("#000000");

  paintFrameCell(frame, 1, 2, "#ffffff");
  fillFrameRect(frame, 14, 30, 4, 4, "#148cff");

  assert.equal(frameCell(frame, 1, 2)?.color, "#ffffff");
  assert.equal(frameCell(frame, 14, 30)?.color, "#148cff");
  assert.equal(frameCell(frame, 15, 31)?.color, "#148cff");
});

test("shared floor effects paint deterministic diamond rings and waves", () => {
  const ring = createFrame("#000000");
  paintDiamondRing(ring, {
    centerX: 8,
    centerY: 16,
    color: "#ffffff",
    radius: 2,
    thickness: 0
  });

  assert.equal(ring.cells.filter((cell) => cell.color === "#ffffff").length, 8);
  assert.equal(frameCell(ring, 8, 14)?.color, "#ffffff");
  assert.equal(frameCell(ring, 8, 16)?.color, "#000000");

  const wave = createFrame("#000000");
  paintDiamondWave(wave, {
    bandWidth: 1,
    centerX: 8,
    centerY: 16,
    color: ({ phase }) => phase === 0 ? "#35d7ff" : undefined,
    period: 4,
    step: 1
  });

  assert.equal(frameCell(wave, 8, 13)?.color, "#35d7ff");
  assert.equal(frameCell(wave, 8, 16)?.color, "#000000");
});

test("smooth pulses are deterministic, periodic, and normalize unsafe inputs", () => {
  const unreadyPulse = (atMillis: number) => sampleSmoothPulse({
    atMillis,
    minValue: 60,
    maxValue: 100,
    periodMillis: 1_600
  });

  assert.equal(unreadyPulse(0), 60);
  assert.equal(unreadyPulse(400), 80);
  assert.equal(unreadyPulse(800), 100);
  assert.equal(unreadyPulse(1_200), 80);
  assert.equal(unreadyPulse(1_600), 60);
  assert.equal(unreadyPulse(-800), 100);
  assert.equal(unreadyPulse(16_800), 100);

  assert.equal(sampleSmoothPulse({
    atMillis: 320,
    minValue: 22,
    maxValue: 42,
    periodMillis: 640
  }), 42);
  assert.equal(sampleSmoothPulse({
    atMillis: 0,
    minValue: 100,
    maxValue: 60,
    periodMillis: 1_600
  }), 60);
  assert.equal(sampleSmoothPulse({
    atMillis: Number.NaN,
    minValue: Number.NaN,
    maxValue: Number.POSITIVE_INFINITY,
    periodMillis: 0
  }), 0);
  assert.equal(sampleSmoothPulse({
    atMillis: 0,
    minValue: 10,
    maxValue: 20,
    periodMillis: 100,
    phaseOffsetMillis: 50
  }), 20);
});

test("floor bounds match the physical grid", () => {
  assert.equal(inFloorBounds(0, 0), true);
  assert.equal(inFloorBounds(15, 31), true);
  assert.equal(inFloorBounds(16, 31), false);
  assert.equal(inFloorBounds(15, 32), false);
});

test("player ready gate requires every presence zone and cancels when a player leaves", () => {
  const zones = createHorizontalPlayerReadyZones(2);
  const gate = createPlayerReadyGate(
    { mode: "player-ready", countdownMillis: 2_000, releaseGraceMillis: 500 },
    zones
  );

  assert.deepEqual(gate.state(0), {
    phase: "waiting",
    readyPlayers: 0,
    requiredPlayers: 2,
    countdownMillis: 0
  });
  assert.equal(gate.update({ x: 4, y: 4, pressed: true, atMillis: 100 }), "none");
  assert.equal(gate.update({ x: 10, y: 28, pressed: true, atMillis: 200 }), "players-ready");
  assert.equal(gate.state(700).countdownMillis, 1_500);
  assert.equal(gate.update({ x: 10, y: 28, pressed: false, atMillis: 800 }), "none");
  assert.equal(gate.tick(1_301), "players-left");
  assert.equal(gate.state(1_301).phase, "waiting");

  gate.update({ x: 10, y: 28, pressed: true, atMillis: 1_400 });
  assert.equal(gate.tick(3_399), "none");
  assert.equal(gate.tick(3_400), "started");
  assert.equal(gate.state(3_400).phase, "running");
});

test("immediate start policy must be explicit and bypasses player detection", () => {
  const gate = createPlayerReadyGate({ mode: "immediate" }, []);
  assert.equal(gate.state(0).phase, "running");
  assert.equal(gate.tick(5_000), "none");
});

test("seeded rng is deterministic", () => {
  const first = createSeededRng(1234);
  const second = createSeededRng(1234);

  assert.deepEqual(
    Array.from({ length: 5 }, () => first.int(1000)),
    Array.from({ length: 5 }, () => second.int(1000))
  );
});

test("manifest config normalization owns defaults, constraints, and difficulty", () => {
  const pointsToWin = {
    key: "points_to_win",
    label: "Points to win",
    playerFacing: true,
    type: "int",
    default: 5,
    min: 1,
    max: 21
  } satisfies GameConfigVar;
  const manifest = {
    ...testManifestFields,
    id: "test",
    label: "Test",
    players: { allowAny: false, min: 1, max: 2 },
    start: { mode: "player-ready" },
    config: {
      difficulty: { default: "hard", options: ["easy", "hard"] },
      vars: [
        pointsToWin,
        { key: "pace", label: "Pace", playerFacing: false, type: "float", default: 1.25, min: 1, max: 2 },
        { key: "sound", label: "Sound", playerFacing: true, type: "bool", default: true },
        {
          key: "color",
          label: "Color",
          playerFacing: true,
          type: "enum",
          default: "blue",
          options: [{ value: "blue" }, { value: "red" }]
        }
      ]
    },
    defaultDurationMillis: 5000,
    display: { entry: "./display" }
  } satisfies GameManifest;
  const config = normalizeGameConfig(
    {
      seed: Number.NaN,
      playerCount: 7,
      difficulty: "expert",
      options: { points_to_win: "30", pace: "1.5", sound: "false", color: "purple", ignored: 8 }
    },
    manifest
  );

  assert.equal(config.seed, DEFAULT_GAME_SEED);
  assert.equal(config.playerCount, 2);
  assert.equal(config.durationMillis, 5000);
  assert.equal(config.difficulty, "hard");
  assert.deepEqual(config.options, {
    points_to_win: 21,
    pace: 1.5,
    sound: false,
    color: "blue"
  });
  assert.equal(readGameConfigOption(config.options, pointsToWin), 21);
  assert.equal(normalizeGameConfig({ seed: 1, playerCount: 0 }, manifest).playerCount, 1);

  const flexibleManifest = {
    ...manifest,
    players: { ...manifest.players, allowAny: true }
  };
  assert.equal(normalizeGameConfig({ seed: 1, playerCount: 0 }, flexibleManifest).playerCount, 0);
  assert.equal(normalizeGameConfig({ seed: 1, playerCount: 12 }, flexibleManifest).playerCount, 2);
  assert.deepEqual(gamePlayerCountOptions(manifest), [1, 2]);
  assert.deepEqual(gamePlayerCountOptions(flexibleManifest), [0, 1, 2]);
  assert.equal(defaultGamePlayerCount(manifest), 1);
  assert.equal(defaultGamePlayerCount(flexibleManifest), 0);
  assert.equal(normalizeGameConfig({}, flexibleManifest).playerCount, 0);
});

test("authored content is defensively copied and deeply immutable", () => {
  const source = {
    schema: "motion-levels-test-content-v1",
    levels: [{ id: "level-1", frames: [[0, 1, 2]] }]
  };
  const content = normalizeGameContent(source);
  assert.ok(content);
  assert.notEqual(content, source);
  assert.notEqual(content.levels, source.levels);
  assert.ok(Object.isFrozen(content));
  assert.ok(Object.isFrozen(content.levels));
  assert.ok(Object.isFrozen((content.levels as readonly unknown[])[0]));

  source.levels[0]?.frames[0]?.push(3);
  assert.deepEqual(content.levels, [{ id: "level-1", frames: [[0, 1, 2]] }]);
  assert.equal(normalizeGameContent({ schema: "", levels: [] }), undefined);
  assert.equal(normalizeGameContent({ schema: "valid", value: Number.NaN }), undefined);
});

test("config value helpers use manifest definitions as the only schema", () => {
  const integerVar = { key: "rounds", label: "Rounds", playerFacing: true, type: "int", default: 3, min: 1, max: 9 } satisfies GameConfigVar;
  const booleanVar = { key: "sound", label: "Sound", playerFacing: true, type: "bool", default: true } satisfies GameConfigVar;
  const enumVar = {
    key: "team",
    label: "Team",
    playerFacing: true,
    type: "enum",
    default: "blue",
    options: [{ value: "blue" }, { value: "red" }]
  } satisfies GameConfigVar;

  assert.equal(normalizeGameConfigValue(integerVar, 99), 9);
  assert.equal(normalizeGameConfigValue(booleanVar, "false"), false);
  assert.equal(normalizeGameConfigValue(enumVar, "unknown"), "blue");
  assert.deepEqual(
    normalizeGameConfigOptions({}, {
      ...testManifestFields,
      id: "options",
      label: "Options",
      players: { allowAny: false, min: 1, max: 1 },
      start: { mode: "player-ready" },
      config: { vars: [integerVar, booleanVar, enumVar] },
      defaultDurationMillis: 1000,
      display: { entry: "./display" }
    }),
    { rounds: 3, sound: true, team: "blue" }
  );
});

test("difficulty options expose only manifest choices or shared defaults", () => {
  const manifest = {
    ...testManifestFields,
    id: "difficulty",
    label: "Difficulty",
    players: { allowAny: false, min: 1, max: 1 },
    start: { mode: "player-ready" },
    defaultDurationMillis: 1000,
    display: { entry: "./display" }
  } satisfies GameManifest;

  assert.deepEqual(gameDifficultyOptions(manifest), ["easy", "medium", "hard", "expert"]);
  assert.equal(normalizeGameConfig({ seed: 1, playerCount: 1, difficulty: "invalid" }, manifest).difficulty, "medium");

  const restrictedManifest = {
    ...manifest,
    config: { difficulty: { default: "hard", options: ["easy", "hard"] } }
  } satisfies GameManifest;
  assert.deepEqual(gameDifficultyOptions(restrictedManifest), ["easy", "hard"]);
  assert.equal(normalizeGameConfig({ difficulty: "expert" }, restrictedManifest).difficulty, "hard");
});

test("seed normalization uses one shared default and the SDK rng domain", () => {
  assert.equal(normalizeGameSeed(undefined), DEFAULT_GAME_SEED);
  assert.equal(normalizeGameSeed(Number.NaN), DEFAULT_GAME_SEED);
  assert.equal(normalizeGameSeed(-4), 0);
  assert.equal(normalizeGameSeed(MAX_GAME_SEED + 10), MAX_GAME_SEED);
});

test("rgb helpers clamp and format colors", () => {
  assert.equal(rgbToHex({ r: 300, g: 16, b: -4 }), "#ff1000");
  assert.deepEqual(scaleRgb({ r: 100, g: 50, b: 10 }, 50), { r: 50, g: 25, b: 5 });
});

test("formatClock renders countdown text", () => {
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(59_001), "1:00");
  assert.equal(formatClock(59_000), "0:59");
  assert.equal(formatClock(0), "0:00");
});

test("gameEvent removes terminal periods from event messages", () => {
  assert.deepEqual(gameEvent("ready", "Ready...", 120), {
    cue: "ready",
    message: "Ready",
    atMillis: 120
  });
});

test("game engine uses 50fps fixed step defaults", () => {
  const game = createFakeGame();
  const engine = createGameEngine(game, {
    initialEvents: [gameEvent("ready", "Ready", 0)]
  });

  assert.equal(engine.fps, DEFAULT_ENGINE_FPS);
  assert.equal(engine.frameMillis, DEFAULT_ENGINE_FRAME_MILLIS);
  assert.equal(engine.state.events[0]?.cue, "ready");

  const state = engine.step();

  assert.equal(state.clockMillis, DEFAULT_ENGINE_FRAME_MILLIS);
  assert.equal(game.ticks[0]?.atMillis, DEFAULT_ENGINE_FRAME_MILLIS);
  assert.equal(state.snapshot.elapsedMillis, DEFAULT_ENGINE_FRAME_MILLIS);
});

test("game engine timestamps input and can replace games", () => {
  const first = createFakeGame();
  const second = createFakeGame();
  const engine = createGameEngine(first, { fps: 60 });

  engine.step(250);
  engine.press(2, 3);
  engine.release(2, 3, 500);

  assert.equal(first.presses[0]?.atMillis, 250);
  assert.equal(first.presses[0]?.pressed, true);
  assert.equal(first.releases[0]?.atMillis, 500);
  assert.equal(engine.clockMillis, 500);

  const state = engine.replaceGame(second, {
    initialEvents: [gameEvent("ready", "Next", 0)]
  });

  assert.equal(state.clockMillis, 0);
  assert.equal(state.fps, 60);
  assert.equal(state.events[0]?.message, "Next");
});

function createFakeGame() {
  const game = {
    ticks: [] as TickEvent[],
    presses: [] as PressEvent[],
    releases: [] as PressEvent[],
    nowMillis: 0,
    init(nowMillis: number) {
      this.nowMillis = nowMillis;
      return [gameEvent("ready", "Ready", nowMillis)];
    },
    press(event: PressEvent) {
      this.nowMillis = event.atMillis;
      this.presses.push(event);
      return [gameEvent("press", `${event.x},${event.y}`, event.atMillis)];
    },
    release(event: PressEvent) {
      this.nowMillis = event.atMillis;
      this.releases.push(event);
      return [gameEvent("release", `${event.x},${event.y}`, event.atMillis)];
    },
    tick(event: TickEvent) {
      this.nowMillis = event.atMillis;
      this.ticks.push(event);
      return [gameEvent("tick", "Tick", event.atMillis)];
    },
    render() {
      return createFrame("#000000");
    },
    snapshot() {
      return {
        activeTargets: 0,
        currentGame: "fake",
        elapsedMillis: this.nowMillis,
        label: "Fake",
        lastEventCue: "none",
        lastEventMessage: "",
        lives: 0,
        phase: "running",
        playerCount: 1,
        players: [],
        remainingMillis: 0,
        score: 0,
        success: false
      };
    },
    reset() {
      this.nowMillis = 0;
      this.ticks = [];
      this.presses = [];
      this.releases = [];
    }
  } satisfies GameInstance & {
    nowMillis: number;
    presses: PressEvent[];
    releases: PressEvent[];
    ticks: TickEvent[];
  };

  return game;
}
