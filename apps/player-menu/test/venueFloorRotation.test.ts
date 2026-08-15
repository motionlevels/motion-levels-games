import assert from "node:assert/strict";
import test from "node:test";
import {
  floorRotationFromSearch,
  floorRotationFromVenueConfig
} from "../src/venueFloorRotation.tsx";
import {
  composeFloorBoardOrientation,
  floorBoardOrientationDegrees
} from "../src/floorView.tsx";

test("kiosk accepts a valid query rotation override", () => {
  assert.equal(floorRotationFromSearch("?floorRotation=180"), 180);
  assert.equal(floorRotationFromSearch("?floorRotation=45"), null);
  assert.equal(floorRotationFromSearch(""), null);
});

test("kiosk normalizes venue configuration safely", () => {
  assert.equal(floorRotationFromVenueConfig({ floorRotationDegrees: 270 }), 270);
  assert.equal(floorRotationFromVenueConfig({ floorRotationDegrees: "90" }), 90);
  assert.equal(floorRotationFromVenueConfig({ floorRotationDegrees: -90 }), 0);
});

test("venue rotation composes with each preview layout", () => {
  assert.equal(composeFloorBoardOrientation("data", 180), "rotate-180");
  assert.equal(composeFloorBoardOrientation("clockwise", 180), "rotate-270");
  assert.equal(floorBoardOrientationDegrees("transpose"), 270);
});
