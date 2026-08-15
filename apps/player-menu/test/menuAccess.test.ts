import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { menuAccessPolicyFromSearch } from "../src/menuAccess.ts";

describe("player-menu access modes", () => {
  it("lets the physical kiosk persist recovery state while following runtime authority", () => {
    assert.deepEqual(menuAccessPolicyFromSearch(""), {
      followMirror: true,
      persistLocalState: true,
      publishMirror: true,
      readOnly: false
    });
  });

  it("keeps the read-only mirror canonical and inert", () => {
    assert.deepEqual(menuAccessPolicyFromSearch("?readOnly=1"), {
      followMirror: true,
      persistLocalState: false,
      publishMirror: false,
      readOnly: true
    });
  });

  it("lets the platform remote publish through the same runtime authority", () => {
    assert.deepEqual(menuAccessPolicyFromSearch("?remoteControl=1"), {
      followMirror: true,
      persistLocalState: false,
      publishMirror: true,
      readOnly: false
    });
  });

  it("keeps explicit read-only mode stronger than remote control", () => {
    assert.equal(menuAccessPolicyFromSearch("?remoteControl=1&mode=readonly").readOnly, true);
  });
});
