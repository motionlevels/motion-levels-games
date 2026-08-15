import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultRecordingScope,
  gatewaySlugFromPathname,
  migrateMotionlevelsOneRecordingScope,
} from "../src/recordingDefaults.ts";

describe("recording defaults", () => {
  it("defaults new venue sessions to one video per game", () => {
    assert.equal(defaultRecordingScope, "selection");
  });

  it("recognizes the gateway slug on native menu routes", () => {
    assert.equal(gatewaySlugFromPathname("/gateways/motionlevels-1/menu/"), "motionlevels-1");
    assert.equal(gatewaySlugFromPathname("/menu/"), "");
  });

  it("migrates the old motionlevels-1 visit default once", () => {
    assert.deepEqual(
      migrateMotionlevelsOneRecordingScope("visit", "/gateways/motionlevels-1/menu/", false),
      { migrated: true, scope: "selection" },
    );
    assert.deepEqual(
      migrateMotionlevelsOneRecordingScope("visit", "/gateways/motionlevels-1/menu/", true),
      { migrated: false, scope: "visit" },
    );
    assert.deepEqual(
      migrateMotionlevelsOneRecordingScope("off", "/gateways/motionlevels-1/menu/", false),
      { migrated: true, scope: "off" },
    );
  });
});
