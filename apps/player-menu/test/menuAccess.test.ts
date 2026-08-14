import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { menuAccessPolicyFromSearch } from "../src/menuAccess.ts";

describe("player-menu access modes", () => {
  it("lets the physical kiosk own persistence and the canonical mirror", () => {
    assert.deepEqual(menuAccessPolicyFromSearch(""), {
      followMirror: false,
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

  it("keeps the platform remote canonical without disabling interaction", () => {
    assert.deepEqual(menuAccessPolicyFromSearch("?remoteControl=1"), {
      followMirror: true,
      persistLocalState: false,
      publishMirror: false,
      readOnly: false
    });
  });

  it("keeps explicit read-only mode stronger than remote control", () => {
    assert.equal(menuAccessPolicyFromSearch("?remoteControl=1&mode=readonly").readOnly, true);
  });
});
