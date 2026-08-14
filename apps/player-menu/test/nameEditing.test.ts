import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanNameDraft, cleanNameWhitespace } from "../src/nameEditing.ts";

describe("player name editing", () => {
  it("keeps one trailing space while a multi-word name is being typed", () => {
    assert.equal(cleanNameDraft("  Ana   ", 12), "Ana ");
    assert.equal(cleanNameDraft("Ana M", 12), "Ana M");
  });

  it("normalizes only when the name is committed", () => {
    assert.equal(cleanNameWhitespace("  Ana   María  ", 12), "Ana María");
    assert.equal(cleanNameWhitespace("Equipo con un nombre muy largo", 10), "Equipo con");
  });
});
