import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createSeededRng,
  fillFrameRect,
  formatClock,
  frameCell,
  inFloorBounds,
  normalizeGameConfig,
  paintFrameCell,
  readClampedIntegerOption,
  rgbToHex,
  scaleRgb,
  setFrameCell
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
