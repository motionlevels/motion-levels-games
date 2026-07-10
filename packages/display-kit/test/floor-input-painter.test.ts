import assert from "node:assert/strict";
import test from "node:test";
import { FloorInputPainter, floorTileFromClientPoint } from "../src/floor-input-painter.ts";

test("a sparse drag keeps every crossed floor tile occupied after pointer-up", () => {
  const painter = new FloorInputPainter();

  assert.deepEqual(painter.begin({ x: 7, y: 3 }), [{ x: 7, y: 3, pressed: true }]);
  const actions = painter.move({ x: 7, y: 28 });
  painter.end();

  assert.equal(actions.length, 25);
  assert.deepEqual(actions[0], { x: 7, y: 4, pressed: true });
  assert.deepEqual(actions.at(-1), { x: 7, y: 28, pressed: true });
  assert.deepEqual(painter.keys(), Array.from({ length: 26 }, (_, index) => `7:${index + 3}`));
});

test("starting on an occupied tile erases crossed inputs without duplicate releases", () => {
  const painter = new FloorInputPainter();
  painter.begin({ x: 7, y: 3 });
  painter.move({ x: 7, y: 28 });
  painter.end();

  assert.deepEqual(painter.begin({ x: 7, y: 3 }), [{ x: 7, y: 3, pressed: false }]);
  assert.deepEqual(painter.move({ x: 7, y: 3 }), []);
  const releaseActions = painter.move({ x: 7, y: 28 });
  assert.equal(releaseActions.length, 25);
  assert.deepEqual(releaseActions.at(-1), { x: 7, y: 28, pressed: false });
  painter.end();

  assert.deepEqual(painter.keys(), []);
});

test("floor hit testing maps tile seams and padding to physical coordinates", () => {
  const bounds = { left: 100, top: 50, width: 320, height: 640 };

  assert.deepEqual(floorTileFromClientPoint(260, 370, bounds, 16, 32), { x: 8, y: 16 });
  assert.deepEqual(floorTileFromClientPoint(259.99, 369.99, bounds, 16, 32), { x: 7, y: 15 });
  assert.deepEqual(floorTileFromClientPoint(100, 50, bounds, 16, 32), { x: 0, y: 0 });
  assert.deepEqual(floorTileFromClientPoint(419.99, 689.99, bounds, 16, 32), { x: 15, y: 31 });
  assert.equal(floorTileFromClientPoint(420, 690, bounds, 16, 32), null);
});

test("reset clears occupied inputs and an in-progress gesture", () => {
  const painter = new FloorInputPainter();
  painter.begin({ x: 4, y: 4 });
  painter.reset();

  assert.deepEqual(painter.keys(), []);
  assert.deepEqual(painter.move({ x: 4, y: 5 }), []);
});
