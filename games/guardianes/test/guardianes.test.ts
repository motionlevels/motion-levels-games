import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlayerDisplay,
  createGame,
  damagedSnapshot,
  failedSnapshot,
  finishedSnapshot,
  guardianLanes,
  guardianesDifficultyProfile,
  guardianesMaxLives,
  guardianesThreatChart,
  manifest,
  runningSnapshot
} from "../src/index.ts";

function startGame(playerCount = 0, difficulty = "medium") {
  const game = createGame({ playerCount, difficulty, durationMillis: manifest.defaultDurationMillis });
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  game.release({ x: 8, y: 16, pressed: false, atMillis: 2_120 });
  return game;
}

test("manifest exposes a production cooperative Any or one-to-eight player defense game", () => {
  assert.equal(manifest.id, "guardianes");
  assert.equal(manifest.availability.production, true);
  assert.equal(manifest.players.allowAny, true);
  assert.deepEqual([manifest.players.min, manifest.players.max], [1, 8]);
  assert.equal(manifest.start.mode, "player-ready");
});

test("central presence starts Any and eight-player modes without changing the board", () => {
  for (const playerCount of [0, 8]) {
    const game = startGame(playerCount);
    assert.equal(game.snapshot().phase, "running");
    assert.equal(game.snapshot().requiredPlayers, 1);
    assert.equal(game.snapshot().threatCount, guardianesThreatChart().length);
  }
});

test("difficulty changes deterministic travel and spacing", () => {
  assert.ok(guardianesDifficultyProfile("expert").travelMillis < guardianesDifficultyProfile("easy").travelMillis);
  assert.ok(guardianesThreatChart("expert")[1]!.spawnMillis < guardianesThreatChart("easy")[1]!.spawnMillis);
  assert.deepEqual(guardianesThreatChart("hard"), guardianesThreatChart("hard"));
});

test("an active matching shield blocks a threat", () => {
  const game = startGame();
  const threat = guardianesThreatChart()[0]!;
  const lane = guardianLanes[threat.lane]!;
  game.press({ x: lane.shieldX, y: 28, pressed: true, atMillis: 2_200 });
  game.tick({ atMillis: 2_100 + threat.impactMillis });
  assert.equal(game.snapshot().blockedThreats, 1);
  assert.equal(game.snapshot().lives, guardianesMaxLives);
  assert.deepEqual(game.snapshot().shieldLanes, [threat.lane]);
});

test("unprotected impacts consume all visible lives and lock failure", () => {
  const game = startGame();
  for (const threat of guardianesThreatChart().slice(0, guardianesMaxLives)) game.tick({ atMillis: 2_100 + threat.impactMillis });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().lives, 0);
  assert.equal(game.snapshot().success, false);
  const resolved = game.snapshot().threatIndex;
  game.press({ x: 1, y: 28, pressed: true, atMillis: 20_000 });
  assert.equal(game.snapshot().threatIndex, resolved);
});

test("blocking the complete chart starts the distinct game-win animation", () => {
  const game = startGame();
  for (const threat of guardianesThreatChart()) {
    const lane = guardianLanes[threat.lane]!;
    game.press({ x: lane.shieldX, y: 28, pressed: true, atMillis: 2_100 + threat.impactMillis - 100 });
    game.tick({ atMillis: 2_100 + threat.impactMillis });
    game.release({ x: lane.shieldX, y: 28, pressed: false, atMillis: 2_100 + threat.impactMillis + 10 });
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().blockedThreats, guardianesThreatChart().length);
  assert.equal(game.snapshot().lives, guardianesMaxLives);
});

test("fixtures and Spanish display cover running, damage, zero lives, and victory", () => {
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(damagedSnapshot.lives, 2);
  assert.equal(failedSnapshot.lives, 0);
  assert.equal(finishedSnapshot.success, true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: damagedSnapshot }));
  assert.match(html, /Vidas del núcleo/);
  assert.match(html, /2 de 4 vidas restantes/);
  assert.match(html, /Amenazas bloqueadas/);
  assert.doesNotMatch(html, /Lives|Threats|Waiting|Player/);
});
