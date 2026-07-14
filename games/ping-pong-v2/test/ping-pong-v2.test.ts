import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplay, createGame, manifest, runningFrame, runningSnapshot } from "../src/index.ts";

function startGame(pointsToWin = 1) {
  const game = createGame({ seed: 202, playerCount: 2, difficulty: "medium", options: { points_to_win: pointsToWin } });
  game.init(0);
  game.press({ x: 7, y: 3, pressed: true, atMillis: 100 });
  game.press({ x: 7, y: 28, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_200 });
  return game;
}

test("manifest exposes the production v2 match", () => {
  assert.equal(manifest.id, "ping-pong-v2");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: true, min: 2, max: 2 });
  assert.equal(manifest.config?.vars?.find((item) => item.key === "points_to_win")?.default, 5);
});

test("both floor halves must be occupied before the match starts", () => {
  const game = createGame({ playerCount: 2 });
  game.init(0);
  game.press({ x: 7, y: 3, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: 7, y: 28, pressed: true, atMillis: 200 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 2_300 });
  assert.equal(game.snapshot().phase, "running");
});

test("v2 keeps the accelerated rally and round model", () => {
  const game = startGame();
  const before = game.snapshot();
  let returned = false;
  for (let atMillis = 2_240; atMillis <= 12_000; atMillis += 40) {
    const current = game.snapshot();
    game.press({ x: current.ball.x, y: current.ball.dy < 0 ? 2 : 29, pressed: true, atMillis: atMillis - 1 });
    if (game.tick({ atMillis }).some((event) => event.cue === "coin")) {
      returned = true;
      break;
    }
  }
  const after = game.snapshot();
  assert.equal(before.currentGame, manifest.id);
  assert.equal(before.matchTarget, 1);
  assert.equal(returned, true);
  assert.ok(after.roundHits > before.roundHits);
  assert.ok(after.ballSpeed > after.initialBallSpeed);
});

test("fixtures and Spanish player display render", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  assert.match(html, /Ping Pong v2/);
  assert.match(html, /Objetivo/);
  assert.match(html, /Peloteo/);
});
