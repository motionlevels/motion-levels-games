import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell, gamePlayerCountOptions } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  checkpointTarget,
  createGame,
  gameWinAnimationMillis,
  manifest,
  startingLives,
  type GalacticCrossingGameInstance
} from "../src/index.ts";
import {
  damagedSnapshot,
  finishedFrame,
  finishedSnapshot,
  runningFrame,
  runningSnapshot
} from "../src/fixtures.ts";

test("manifest exposes the production Any-player crossing game", () => {
  assert.equal(manifest.id, "cruce-galactico");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(gamePlayerCountOptions(manifest), [0, 1, 2, 3, 4]);
  assert.equal(manifest.start.mode, "player-ready");
});

test("the bottom platform starts and can cancel the countdown", () => {
  const game = createGame({ playerCount: 0 });
  game.init(0);
  game.press({ x: 8, y: 30, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "starting");
  game.release({ x: 8, y: 30, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 1_701 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("waiting, running hazards, and difficulty animate deterministically", () => {
  const first = createGame({ playerCount: 1, difficulty: "hard" });
  const second = createGame({ playerCount: 1, difficulty: "hard" });
  first.init(0);
  second.init(0);
  const waiting = first.render();
  first.tick({ atMillis: 200 });
  assert.notDeepEqual(first.render(), waiting);
  start(first);
  start(second);
  first.tick({ atMillis: 3_500 });
  second.tick({ atMillis: 3_500 });
  assert.deepEqual(first.snapshot().hazards, second.snapshot().hazards);
  assert.ok(first.snapshot().hazards.length > 0);
});

test("touching traffic costs lives with an immunity window", () => {
  const game = createGame({ playerCount: 1 });
  game.init(0);
  start(game);
  game.release({ x: 8, y: 30, pressed: false, atMillis: 2_150 });
  game.tick({ atMillis: 3_000 });
  const hazard = game.snapshot().hazards.find((candidate) => candidate.x >= 0)!;
  game.press({ x: hazard.x, y: hazard.y, pressed: true, atMillis: 3_001 });
  game.tick({ atMillis: 3_002 });
  assert.equal(game.snapshot().lives, startingLives - 1);
  game.tick({ atMillis: 3_100 });
  assert.equal(game.snapshot().lives, startingLives - 1);
});

test("four checkpoints trigger a protected game-win animation", () => {
  const game = createGame({ playerCount: 1 });
  game.init(0);
  start(game);
  for (const [index, y] of [22, 15, 8, 1].entries()) {
    game.press({ x: 8, y, pressed: true, atMillis: 2_200 + index * 100 });
  }
  assert.equal(game.snapshot().checkpoint, checkpointTarget);
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  const winFrame = game.render();
  game.press({ x: 1, y: 1, pressed: true, atMillis: 2_700 });
  assert.equal(game.snapshot().checkpoint, checkpointTarget);
  game.tick({ atMillis: 3_200 });
  assert.notDeepEqual(game.render(), winFrame);
  game.tick({ atMillis: 2_500 + gameWinAnimationMillis });
  assert.equal(game.snapshot().celebrating, false);
});

test("the timer and final impact can fail the mission", () => {
  const timed = createGame({ playerCount: 1, durationMillis: 500 });
  timed.init(0);
  start(timed);
  timed.tick({ atMillis: 2_601 });
  assert.equal(timed.snapshot().phase, "finished");
  assert.equal(timed.snapshot().lastEventMessage, "Tiempo agotado");

  const damaged = createGame({ playerCount: 1 });
  damaged.init(0);
  start(damaged);
  damaged.release({ x: 8, y: 30, pressed: false, atMillis: 2_150 });
  for (let hit = 0; hit < startingLives; hit += 1) {
    const atMillis = 3_000 + hit * 2_000;
    damaged.tick({ atMillis });
    const hazard = damaged.snapshot().hazards.find((candidate) => candidate.x >= 0)!;
    damaged.press({ x: hazard.x, y: hazard.y, pressed: true, atMillis: atMillis + 1 });
    damaged.tick({ atMillis: atMillis + 2 });
    damaged.release({ x: hazard.x, y: hazard.y, pressed: false, atMillis: atMillis + 3 });
  }
  assert.equal(damaged.snapshot().lives, 0);
  assert.equal(damaged.snapshot().phase, "finished");
});

test("fixtures and Spanish display cover the main metric states", () => {
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(damagedSnapshot.lives, 2);
  assert.equal(finishedSnapshot.success, true);
  assert.equal(frameCell(finishedFrame, 8, 16)?.color.startsWith("#"), true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  assert.match(html, /Controles/);
  assert.match(html, /Vidas/);
  assert.match(html, /Tiempo/);
  assert.match(html, /Corredores en el suelo/);
  assert.equal((html.match(/data-life-state="remaining"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Score|Lives|Time/);

  const finishedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: finishedSnapshot, frame: finishedFrame }));
  assert.match(finishedHtml, /is-celebrating/);
  assert.match(finishedHtml, /¡Portal alcanzado!/);
});

function start(game: GalacticCrossingGameInstance): void {
  if (game.snapshot().phase === "waiting") game.press({ x: 8, y: 30, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  assert.equal(game.snapshot().phase, "running");
}
