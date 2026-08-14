import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameCard } from "../src/catalog.ts";
import { gameForMenuIdentity } from "../src/gameIdentity.ts";

const pingPongV2 = game({
  id: "d5fd3186-8268-4bd3-8c15-780f20d8662f",
  engineGame: "motion-levels-games:ping-pong-v2",
  sourceGameId: "ping-pong-v2",
  label: "Ping Pong v2",
});
const parkour = game({
  id: "c1daea4f-e586-4116-8cbe-871cde887a81",
  engineGame: "parkour",
  sourceGameId: "c1daea4f-e586-4116-8cbe-871cde887a81",
  label: "Parkour",
});
const orderedCatalog = [pingPongV2, parkour];

describe("player menu game identity", () => {
  it("resolves the legacy Parkour slug to its canonical row instead of the first catalog game", () => {
    assert.equal(orderedCatalog[0].label, "Ping Pong v2");
    assert.strictEqual(gameForMenuIdentity(orderedCatalog, "parkour"), parkour);
    assert.strictEqual(gameForMenuIdentity(orderedCatalog, parkour.id), parkour);
    assert.strictEqual(gameForMenuIdentity(orderedCatalog, "motion-levels-games:parkour"), parkour);
  });

  it("keeps the separate Ping Pong v2 catalog and source identities connected", () => {
    assert.strictEqual(gameForMenuIdentity(orderedCatalog, pingPongV2.id), pingPongV2);
    assert.strictEqual(gameForMenuIdentity(orderedCatalog, "ping-pong-v2"), pingPongV2);
  });

  it("does not guess when an alias is unknown or ambiguous", () => {
    assert.equal(gameForMenuIdentity(orderedCatalog, "missing-game"), undefined);
    assert.equal(gameForMenuIdentity([
      game({ id: "first", engineGame: "shared" }),
      game({ id: "second", engineGame: "shared" }),
    ], "shared"), undefined);
  });
});

function game(patch: Partial<GameCard>): GameCard {
  return {
    id: "game",
    label: "Juego",
    category: "arcade",
    color: "#005af8",
    players: "Sin requisito",
    difficulty: "Media",
    duration: "",
    mode: "",
    audio: "",
    description: "",
    rules: [],
    ...patch,
  };
}
