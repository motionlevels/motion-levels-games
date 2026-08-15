import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { menuAccessPolicyFromSearch } from "../src/menuAccess.ts";
import { resolveMenuMirrorEnvelope } from "../src/menuMirror.ts";

describe("embedded menu mirror hydration", () => {
  it("lets an interactive remote seed a runtime that has no snapshot yet", () => {
    const access = menuAccessPolicyFromSearch("?remoteControl=1");
    const resolved = resolveMenuMirrorEnvelope({
      version: 0,
      updatedUnixMillis: 0,
      snapshot: null,
    }, 0, 0);

    assert.equal(access.readOnly, false);
    assert.equal(resolved.ready, true);
    assert.equal(resolved.accepted, false);
    assert.equal(resolved.snapshot, null);
  });

  it("accepts only a newer non-null kiosk snapshot", () => {
    const snapshot = { menu: { sessionActive: true } };
    const fresh = resolveMenuMirrorEnvelope({ version: 2, updatedUnixMillis: 200, snapshot }, 1, 100);
    const stale = resolveMenuMirrorEnvelope({ version: 1, updatedUnixMillis: 100, snapshot }, 2, 200);

    assert.equal(fresh.accepted, true);
    assert.deepEqual(fresh.snapshot, snapshot);
    assert.equal(stale.accepted, false);
    assert.equal(stale.snapshot, null);
  });
});
