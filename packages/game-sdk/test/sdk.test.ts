import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createSeededRng,
  formatClock,
  frameCell,
  inFloorBounds,
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

test("formatClock renders countdown text", () => {
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(59_001), "1:00");
  assert.equal(formatClock(59_000), "0:59");
  assert.equal(formatClock(0), "0:00");
});

