import assert from "node:assert/strict";
import test from "node:test";
import { FloorInputPainter } from "../src/floor-input-painter.ts";

test("a drag keeps every crossed floor tile occupied after pointer-up", () => {
  const painter = new FloorInputPainter();

  assert.deepEqual(painter.begin({ x: 7, y: 3 }), [{ x: 7, y: 3, pressed: true }]);
  assert.deepEqual(painter.move({ x: 7, y: 16 }), [{ x: 7, y: 16, pressed: true }]);
  assert.deepEqual(painter.move({ x: 7, y: 28 }), [{ x: 7, y: 28, pressed: true }]);
  painter.end();

  assert.deepEqual(painter.keys(), ["7:3", "7:16", "7:28"]);
});

test("starting on an occupied tile erases crossed inputs without duplicate releases", () => {
  const painter = new FloorInputPainter();
  painter.begin({ x: 7, y: 3 });
  painter.move({ x: 7, y: 28 });
  painter.end();

  assert.deepEqual(painter.begin({ x: 7, y: 3 }), [{ x: 7, y: 3, pressed: false }]);
  assert.deepEqual(painter.move({ x: 7, y: 3 }), []);
  assert.deepEqual(painter.move({ x: 7, y: 28 }), [{ x: 7, y: 28, pressed: false }]);
  painter.end();

  assert.deepEqual(painter.keys(), []);
});

test("reset clears occupied inputs and an in-progress gesture", () => {
  const painter = new FloorInputPainter();
  painter.begin({ x: 4, y: 4 });
  painter.reset();

  assert.deepEqual(painter.keys(), []);
  assert.deepEqual(painter.move({ x: 4, y: 5 }), []);
});
