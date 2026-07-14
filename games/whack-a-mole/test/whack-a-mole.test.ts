import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplay, createGame, finishedSnapshot, manifest, readyZonesForPlayers, runningSnapshot } from "../src/index.ts";

function start(playerCount = 4, durationMillis = 60_000) {
  const game = createGame({ playerCount, seed: 404, durationMillis });
  game.init(0);
  game.playerReadyZones().forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  game.tick({ atMillis: 2_200 });
  return game;
}

test("manifest describes the strict one-to-eight player reaction game", () => {
  assert.equal(manifest.id, "whack-a-mole");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: false, min: 1, max: 8 });
});

test("every supported roster gets distinct readiness platforms", () => {
  for (let count = 1; count <= 8; count += 1) {
    const zones = readyZonesForPlayers(count);
    assert.equal(zones.length, count);
    assert.equal(new Set(zones.map((zone) => `${zone.minX},${zone.minY}`)).size, count);
  }
});

test("all configured players must be ready before targets spawn", () => {
  const game = createGame({ playerCount: 8 });
  game.init(0);
  game.playerReadyZones().slice(0, 7).forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  assert.equal(game.snapshot().phase, "waiting");
  const last = game.playerReadyZones()[7]!;
  game.press({ x: last.minX, y: last.minY, pressed: true, atMillis: 200 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 2_300 });
  assert.equal(game.snapshot().targets.length, 8);
});

test("a fast target hit awards the owner points and immediately respawns", () => {
  const game = start(2);
  const before = game.snapshot();
  const target = before.targets[1]!;
  const events = game.press({ x: target.x, y: target.y, pressed: true, atMillis: 2_250 });
  const after = game.snapshot();
  assert.equal(events[0]?.cue, "hit");
  assert.ok((after.playerProgress[1]?.score ?? 0) >= 4);
  assert.equal(after.targets.length, 2);
  assert.notDeepEqual(after.targets[1], target);
});

test("expired targets respawn with catch-up time and misses do not score", () => {
  const game = start(1);
  const score = game.snapshot().score;
  game.press({ x: 15, y: 31, pressed: true, atMillis: 2_250 });
  assert.equal(game.snapshot().score, score);
  const deadline = game.snapshot().targets[0]!.deadlineMillis;
  game.tick({ atMillis: deadline + 1 });
  assert.equal(game.snapshot().targets.length, 1);
  assert.ok(game.snapshot().targets[0]!.remainingMillis > 2_000);
});

test("time selects a winner, locks scoring, and resets after celebration", () => {
  const game = start(2, 3_000);
  const target = game.snapshot().targets[1]!;
  game.press({ x: target.x, y: target.y, pressed: true, atMillis: 2_300 });
  game.tick({ atMillis: 5_300 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().winnerIndex, 1);
  const score = game.snapshot().score;
  game.press({ x: 0, y: 0, pressed: true, atMillis: 5_400 });
  assert.equal(game.snapshot().score, score);
  game.tick({ atMillis: 9_400 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("fixtures and Spanish display cover active play and winner", () => {
  assert.equal(runningSnapshot.targets.length, 4);
  assert.equal(finishedSnapshot.phase, "finished");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: finishedSnapshot }));
  assert.match(html, /Atrapa al topo/);
  assert.match(html, /Topos atrapados/);
});
