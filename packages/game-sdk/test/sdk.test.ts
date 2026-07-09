import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createGameEngine,
  createFrame,
  createSeededRng,
  DEFAULT_ENGINE_FPS,
  DEFAULT_ENGINE_FRAME_MILLIS,
  fillFrameRect,
  formatClock,
  frameCell,
  gameEvent,
  inFloorBounds,
  normalizeGameConfig,
  paintFrameCell,
  readClampedIntegerOption,
  rgbToHex,
  scaleRgb,
  setFrameCell,
  type GameInstance,
  type PressEvent,
  type TickEvent
} from "../src/index.ts";

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

test("floor bounds match the physical grid", () => {
  assert.equal(inFloorBounds(0, 0), true);
  assert.equal(inFloorBounds(15, 31), true);
  assert.equal(inFloorBounds(16, 31), false);
  assert.equal(inFloorBounds(15, 32), false);
});

test("seeded rng is deterministic", () => {
  const first = createSeededRng(1234);
  const second = createSeededRng(1234);

  assert.deepEqual(
    Array.from({ length: 5 }, () => first.int(1000)),
    Array.from({ length: 5 }, () => second.int(1000))
  );
});

test("manifest config normalization clamps players and reads options", () => {
  const manifest = {
    id: "test",
    label: "Test",
    players: { min: 1, max: 2 },
    defaultDurationMillis: 5000,
    defaultSeed: 123,
    display: { entry: "./display" }
  };
  const config = normalizeGameConfig(
    {
      seed: Number.NaN,
      playerCount: 7,
      difficulty: "hard",
      options: { points_to_win: "3" }
    },
    manifest
  );

  assert.equal(config.seed, 123);
  assert.equal(config.playerCount, 2);
  assert.equal(config.durationMillis, 5000);
  assert.equal(config.difficulty, "hard");
  assert.equal(readClampedIntegerOption(config.options, "points_to_win", 5, 1, 21), 3);

  assert.equal(normalizeGameConfig({ seed: 1, playerCount: 0 }, manifest).playerCount, 0);
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

test("game engine uses 30fps fixed step defaults", () => {
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
