import assert from "node:assert/strict";
import test from "node:test";
import {
  composeFloorRotations,
  displayToFloorCoordinate,
  floorDisplaySize,
  floorToDisplayCoordinate,
  normalizeFloorRotationDegrees
} from "../src/index.ts";

test("floor rotations accept only quarter turns", () => {
  assert.equal(normalizeFloorRotationDegrees(90), 90);
  assert.equal(normalizeFloorRotationDegrees("rotate-270"), 270);
  assert.equal(normalizeFloorRotationDegrees(45), 0);
  assert.equal(normalizeFloorRotationDegrees("invalid"), 0);
  assert.equal(composeFloorRotations(270, 180), 90);
});

test("floor rotation swaps display dimensions only for sideways views", () => {
  assert.deepEqual(floorDisplaySize(16, 32, 0), { width: 16, height: 32 });
  assert.deepEqual(floorDisplaySize(16, 32, 90), { width: 32, height: 16 });
  assert.deepEqual(floorDisplaySize(16, 32, 180), { width: 16, height: 32 });
  assert.deepEqual(floorDisplaySize(16, 32, 270), { width: 32, height: 16 });
});

test("floor and display coordinate transforms are exact inverses", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    for (const coordinate of [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 15, y: 31 }]) {
      const displayed = floorToDisplayCoordinate(coordinate, 16, 32, rotation);
      assert.deepEqual(displayToFloorCoordinate(displayed, 16, 32, rotation), coordinate);
    }
  }
});
