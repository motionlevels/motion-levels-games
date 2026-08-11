import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCanonicalEntityID } from "../src/identity.ts";

describe("canonical entity identity", () => {
  it("accepts UUIDs and lowercase 32, 40, or 64 character hashes", () => {
    assert.equal(isCanonicalEntityID("c1daea4f-e586-4116-8cbe-871cde887a81"), true);
    assert.equal(isCanonicalEntityID("C1DAEA4F-E586-4116-8CBE-871CDE887A81"), true);
    assert.equal(isCanonicalEntityID("a".repeat(32)), true);
    assert.equal(isCanonicalEntityID("b".repeat(40)), true);
    assert.equal(isCanonicalEntityID("c".repeat(64)), true);
  });

  it("rejects aliases, unsupported lengths, and uppercase hashes", () => {
    assert.equal(isCanonicalEntityID("parkour"), false);
    assert.equal(isCanonicalEntityID("a".repeat(39)), false);
    assert.equal(isCanonicalEntityID("A".repeat(40)), false);
    assert.equal(isCanonicalEntityID("g".repeat(64)), false);
  });
});
