import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EngineStatus } from "../src/api.ts";
import type { GameCard } from "../src/catalog.ts";
import {
  activeRosterIssue,
  avatarLabel,
  channelToHex,
  colorChannels,
  colorDistanceSquared,
  firstAvailableColor,
  gameRosterIssue,
  normalizeRosterName,
  playerLabel,
  rgbToHex,
  rosterSnapshot,
  statusPlayersForDisplay,
  type Player,
} from "../src/roster.ts";

function player(patch: Partial<Player> = {}): Player {
  return { id: 1, name: "", color: "#ff0000", active: true, ...patch };
}

function gameCard(patch: Partial<GameCard> = {}): GameCard {
  return {
    id: "demo",
    label: "Demo",
    category: "individual",
    color: "#ffffff",
    players: "2-4",
    difficulty: "",
    duration: "",
    mode: "",
    audio: "",
    description: "",
    rules: [],
    minPlayers: 2,
    maxPlayers: 4,
    ...patch,
  };
}

describe("roster color helpers", () => {
  it("parses hex channels and rejects malformed input", () => {
    assert.deepEqual(colorChannels("#ff8800"), [255, 136, 0]);
    assert.deepEqual(colorChannels("00ff00"), [0, 255, 0]);
    assert.deepEqual(colorChannels("#fff"), [0, 0, 0]);
    assert.deepEqual(colorChannels("nonsense"), [0, 0, 0]);
  });

  it("formats channels and rgb to hex with clamping", () => {
    assert.equal(channelToHex(0), "00");
    assert.equal(channelToHex(255), "ff");
    assert.equal(channelToHex(300), "ff");
    assert.equal(channelToHex(-5), "00");
    assert.equal(rgbToHex({ r: 255, g: 0, b: 16 }), "#ff0010");
  });

  it("computes squared color distance", () => {
    assert.equal(colorDistanceSquared("#000000", "#000000"), 0);
    assert.equal(colorDistanceSquared("#ff0000", "#000000"), 255 ** 2);
    assert.equal(colorDistanceSquared("#010203", "#040201"), 3 ** 2 + 0 + 2 ** 2);
  });

  it("picks an unused color that is most distinct from active ones", () => {
    const players = [player({ id: 1, color: "#ff0000" }), player({ id: 2, color: "#00ff00" })];
    const chosen = firstAvailableColor(players);
    assert.notEqual(chosen.toLowerCase(), "#ff0000");
    assert.notEqual(chosen.toLowerCase(), "#00ff00");
  });
});

describe("roster labels", () => {
  it("falls back to a positional player label", () => {
    const players = [player({ id: 1, name: "" }), player({ id: 2, name: "Ana" })];
    assert.equal(playerLabel(players, players[0]), "Jugador 1");
    assert.equal(playerLabel(players, players[1]), "Ana");
  });

  it("uses the leading initial or position for avatar labels", () => {
    const players = [player({ id: 1, name: "" }), player({ id: 2, name: "Ana Lopez" })];
    assert.equal(avatarLabel(players, players[0]), "1");
    assert.equal(avatarLabel(players, players[1]), "A");
  });

  it("normalizes roster names for comparison", () => {
    assert.equal(normalizeRosterName("  Ana   María  "), "ana maría");
  });

  it("maps engine status players into roster players", () => {
    const status = {
      players: [
        { index: 0, label: "Rojo", color: { r: 255, g: 0, b: 0 } },
        { index: 1, label: "Verde", color: { r: 0, g: 255, b: 0 } },
      ],
    } as unknown as EngineStatus;
    assert.deepEqual(statusPlayersForDisplay(status), [
      { id: 1, name: "Rojo", color: "#ff0000", active: true },
      { id: 2, name: "Verde", color: "#00ff00", active: true },
    ]);
    assert.deepEqual(statusPlayersForDisplay(null), []);
  });

  it("snapshots only active players with resolved colors", () => {
    const players = [player({ id: 1, name: "Ana", active: true }), player({ id: 2, name: "", color: "#00ff00", active: false })];
    const snapshot = rosterSnapshot(players);
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].label, "Ana");
    assert.deepEqual(snapshot[0].color, { r: 255, g: 0, b: 0 });
  });
});

describe("roster validation", () => {
  it("flags duplicate names", () => {
    const players = [player({ id: 1, name: "Ana", color: "#ff0000" }), player({ id: 2, name: "ana", color: "#00ff00" })];
    const issue = activeRosterIssue(players);
    assert.ok(issue);
    assert.match(issue.message, /ya está en uso/);
    assert.deepEqual([...issue.playerIds], [1, 2]);
  });

  it("flags duplicate colors", () => {
    const players = [player({ id: 1, name: "Ana", color: "#ff0000" }), player({ id: 2, name: "Bea", color: "#ff0000" })];
    const issue = activeRosterIssue(players);
    assert.ok(issue);
    assert.match(issue.message, /color distinto/);
  });

  it("returns null for a valid roster", () => {
    const players = [player({ id: 1, name: "Ana", color: "#ff0000" }), player({ id: 2, name: "Bea", color: "#00ff00" })];
    assert.equal(activeRosterIssue(players), null);
  });

  it("enforces game player bounds and defers to duplicate checks", () => {
    const game = gameCard({ minPlayers: 2, maxPlayers: 4 });
    const tooFew = gameRosterIssue(game, [player({ id: 1, name: "Ana", color: "#ff0000" })]);
    assert.ok(tooFew);
    assert.match(tooFew.message, /al menos 2/);

    const tooMany = gameRosterIssue(
      game,
      [1, 2, 3, 4, 5].map((id) => player({ id, name: `J${id}`, color: rgbToHex({ r: id * 30, g: id * 10, b: id * 5 }) })),
    );
    assert.ok(tooMany);
    assert.match(tooMany.message, /Máximo 4/);

    const valid = gameRosterIssue(game, [player({ id: 1, name: "Ana", color: "#ff0000" }), player({ id: 2, name: "Bea", color: "#00ff00" })]);
    assert.equal(valid, null);

    const duplicate = gameRosterIssue(game, [player({ id: 1, name: "Ana", color: "#ff0000" }), player({ id: 2, name: "Ana", color: "#00ff00" })]);
    assert.ok(duplicate);
    assert.match(duplicate.message, /ya está en uso/);
  });

  it("does not block allow-any games on an empty or draft roster", () => {
    const game = gameCard({ allowAnyPlayers: true, minPlayers: 1, maxPlayers: 6, players: "Sin requisito" });
    assert.equal(gameRosterIssue(game, []), null);
    assert.equal(gameRosterIssue(game, [
      player({ id: 1, name: "Ana", color: "#ff0000" }),
      player({ id: 2, name: "Ana", color: "#ff0000" }),
    ]), null);
  });
});
