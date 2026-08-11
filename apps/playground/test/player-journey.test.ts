import assert from "node:assert/strict";
import test from "node:test";
import { readPlayerJourneyLaunch } from "../src/playerJourney.ts";
import type { PlaygroundGame } from "../src/gameRegistry.ts";
import { manifest } from "../../../games/ping-pong/src/manifest.ts";

const playgroundGames = [{ manifest }] as unknown as readonly PlaygroundGame[];

test("player journey selects and normalizes kiosk launch settings", () => {
  const game = playgroundGames.find((candidate) => candidate.manifest.id === "ping-pong");
  assert.ok(game);
  const launch = readPlayerJourneyLaunch(
    playgroundGames,
    "?journey=1&game=ping-pong&players=2&difficulty=hard&options=%7B%7D",
  );
  assert.equal(launch?.gameId, "ping-pong");
  assert.equal(launch?.playerCount, 2);
  assert.equal(launch?.difficulty, "hard");
});

test("player journey rejects games outside the runtime registry", () => {
  assert.equal(readPlayerJourneyLaunch(playgroundGames, "?journey=1&game=missing"), undefined);
});
