import assert from "node:assert/strict";
import test from "node:test";
import {
  floorRotationFromSearch,
  floorRotationFromVenueConfig
} from "../src/venueFloorRotation.tsx";

test("player display accepts a valid query rotation override", () => {
  assert.equal(floorRotationFromSearch("?floorRotation=270"), 270);
  assert.equal(floorRotationFromSearch("?floorRotation=45"), null);
  assert.equal(floorRotationFromSearch(""), null);
});

test("player display normalizes venue configuration safely", () => {
  assert.equal(floorRotationFromVenueConfig({ floorRotationDegrees: 180 }), 180);
  assert.equal(floorRotationFromVenueConfig({ floorRotationDegrees: "90" }), 90);
  assert.equal(floorRotationFromVenueConfig({ floorRotationDegrees: 12 }), 0);
  assert.equal(floorRotationFromVenueConfig({}), 0);
});
