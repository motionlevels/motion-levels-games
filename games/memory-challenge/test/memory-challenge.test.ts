import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplay, createGame, failedSnapshot, finishedSnapshot, laneLayout, manifest, memorizingFrame, recallingSnapshot } from "../src/index.ts";

function startedGame(playerCount = 2) {
  const game = createGame({ playerCount, seed: 137 });
  game.init(0);
  game.playerReadyZones().forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  game.tick({ atMillis: 2_200 });
  return game;
}

test("manifest describes the strict one-to-four player memory race", () => {
  assert.equal(manifest.id, "memory-challenge");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: false, min: 1, max: 4 });
});

test("each supported player count owns a distinct lane and readiness zone", () => {
  for (let count = 1; count <= 4; count += 1) {
    const lanes = laneLayout(count);
    const game = createGame({ playerCount: count, seed: 22 });
    assert.equal(lanes.length, count);
    assert.equal(game.playerReadyZones().length, count);
    for (let index = 0; index < count; index += 1) {
      assert.ok(game.pathForPlayer(index).every((point) => point.x >= lanes[index]!.x && point.x < lanes[index]!.x + lanes[index]!.width));
    }
  }
});

test("all players must occupy their own exits before the countdown", () => {
  const game = createGame({ playerCount: 3 });
  game.init(0);
  const zones = game.playerReadyZones();
  zones.slice(0, 2).forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: zones[2]!.minX, y: zones[2]!.minY, pressed: true, atMillis: 150 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 2_200 });
  assert.equal(game.snapshot().memoryStage, "memorize");
});

test("paths are deterministic and become hidden recall challenges", () => {
  const left = startedGame();
  const right = startedGame();
  assert.deepEqual(left.pathForPlayer(0), right.pathForPlayer(0));
  assert.equal(left.snapshot().memoryStage, "memorize");
  assert.ok(memorizingFrame.cells.some((cell) => cell.color !== "#05070a"));
  left.tick({ atMillis: 5_100 });
  assert.equal(left.snapshot().memoryStage, "recall");
});

test("a lava mistake requires returning to the player exit", () => {
  const game = startedGame();
  game.tick({ atMillis: 5_100 });
  const path = game.pathForPlayer(0);
  const miss = { x: path[0]!.x === 0 ? 1 : 0, y: 31 };
  game.press({ ...miss, pressed: true, atMillis: 5_200 });
  assert.equal(game.snapshot().playerProgress[0]?.status, "failed");
  const zone = game.playerReadyZones()[0]!;
  game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 5_300 });
  assert.equal(game.snapshot().playerProgress[0]?.status, "memorizing");
});

test("the first complete path wins and input stays locked during celebration", () => {
  const game = startedGame();
  game.tick({ atMillis: 5_100 });
  game.pathForPlayer(1).forEach((point, index) => game.press({ ...point, pressed: true, atMillis: 5_200 + index }));
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().winnerIndex, 1);
  const before = game.snapshot().score;
  game.pathForPlayer(0).forEach((point) => game.press({ ...point, pressed: true, atMillis: 6_000 }));
  assert.equal(game.snapshot().score, before);
  game.tick({ atMillis: 10_000 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("fixtures and Spanish display cover recall, failure, and victory", () => {
  assert.equal(recallingSnapshot.memoryStage, "recall");
  assert.equal(failedSnapshot.playerProgress[0]?.status, "failed");
  assert.equal(finishedSnapshot.success, true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: finishedSnapshot }));
  assert.match(html, /Reto de memoria/);
  assert.match(html, /Camino completado/);
  assert.match(html, /aria-label="[^"]+: [0-9]+ baldosas"/);
  assert.match(html, /aria-valuetext="[0-9]+ de [0-9]+ baldosas"/);
  assert.doesNotMatch(html, /\.\.\./);
});
