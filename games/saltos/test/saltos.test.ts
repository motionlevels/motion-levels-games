import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import { PlayerDisplay, createGame, finishedSnapshot, manifest, runningFrame, runningSnapshot, saltosCelebrationMillis, waitingSnapshot } from "../src/index.ts";

function start(game: ReturnType<typeof createGame>) {
  game.init(0);
  game.press({ x: 8, y: 4, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
}

test("manifest describes the Motion Go Saltos successor", () => {
  assert.equal(manifest.id, "saltos");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: true, min: 1, max: 1 });
});

test("waits for the blue platform before starting", () => {
  const game = createGame({ playerCount: 0, seed: 137 });
  game.init(0);
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: 8, y: 4, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 2_100 });
  assert.equal(game.snapshot().phase, "running");
  assert.ok(game.snapshot().targetPlatform);
});

test("safe jumps score and lava ends the run with a timed result", () => {
  const game = createGame({ playerCount: 1, seed: 137 });
  start(game);
  const target = game.snapshot().targetPlatform;
  assert.ok(target);
  const scoreEvents = game.press({ ...target, pressed: true, atMillis: 2_200 });
  assert.equal(scoreEvents[0]?.message, "Salto 1");
  assert.equal(game.snapshot().score, 1);

  game.press({ x: 0, y: 31, pressed: true, atMillis: 2_300 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().lives, 0);
  assert.equal(game.snapshot().success, false);
  game.tick({ atMillis: 2_300 + saltosCelebrationMillis });
  assert.equal(game.snapshot().phase, "waiting");
});

test("surviving the minute wins and ignores input during celebration", () => {
  const game = createGame({ playerCount: 1, seed: 137 });
  start(game);
  game.tick({ atMillis: 62_100 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  const score = game.snapshot().score;
  game.press({ x: 0, y: 31, pressed: true, atMillis: 62_200 });
  assert.equal(game.snapshot().score, score);
});

test("fixtures and Spanish player display cover the core phases", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(finishedSnapshot.success, true);
  assert.ok(frameCell(runningFrame, runningSnapshot.currentPlatform.x, runningSnapshot.currentPlatform.y));
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  assert.match(html, /Saltos/);
  assert.match(html, /Tiempo/);
  assert.match(html, /Vida/);
  assert.match(html, /ml-lives-meter/);
  assert.doesNotMatch(html, /Score|Lives|Message/);
});
