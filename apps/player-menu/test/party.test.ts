import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GameCard } from "../src/catalog.ts";
import { partyCatalogIsComplete, partyLaunchGame } from "../src/party.ts";

function card(id: string, engineGame = id): GameCard {
  return {
    id,
    engineGame,
    label: id,
    category: "arcade",
    color: "#000000",
    players: "Sin requisito",
    difficulty: "Media",
    duration: "1 min",
    mode: "Juego",
    audio: "Sin audio",
    description: "",
    rules: [],
  };
}

describe("party game resolution", () => {
  it("returns ordinary games unchanged", () => {
    const game = card("solo");
    assert.equal(partyLaunchGame(game, [game]), game);
  });

  it("resolves every party child by catalog or engine id", () => {
    const first = card("first");
    const second = card("second-card", "second-runtime");
    const party = {
      ...card("party"),
      partyMiniGames: [{ gameId: "first" }, { gameId: "second-runtime" }],
    };
    assert.equal(partyLaunchGame(party, [party, first, second], 0), first);
    assert.equal(partyLaunchGame(party, [party, first, second], 1), second);
    assert.equal(partyCatalogIsComplete(party, [party, first, second]), true);
  });

  it("fails closed when a referenced child disappears from the catalog", () => {
    const party = {
      ...card("party"),
      partyMiniGames: [{ gameId: "removed-game" }],
    };
    assert.equal(partyLaunchGame(party, [party]), null);
    assert.equal(partyCatalogIsComplete(party, [party]), false);
  });
});
