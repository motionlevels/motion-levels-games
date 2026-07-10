import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  damagedFrame,
  damagedSnapshot,
  hazardColor,
  helloWorldCelebrationMillis,
  helloWorldHazards,
  helloWorldStartingLives,
  helloWorldTargetScore,
  helloWorldTargets,
  idleColor,
  losingFrame,
  losingSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  startingSnapshot,
  targetColor,
  waitingSnapshot,
  winningFrame,
  winningSnapshot
} from "../src/index.ts";

test("manifest documents the Hola Mundo example game", () => {
  assert.equal(manifest.id, "hello-world");
  assert.equal(manifest.label, "Hola Mundo");
  assert.deepEqual(manifest.players, { allowAny: true, min: 1, max: 1 });
  assert.deepEqual(manifest.start, { mode: "player-ready" });
});

test("Any player mode preserves the same Hola Mundo board and rules", () => {
  const anyPlayers = createGame({ playerCount: 0, seed: 137 });
  const onePlayer = createGame({ playerCount: 1, seed: 137 });

  anyPlayers.init(0);
  onePlayer.init(0);

  assert.equal(anyPlayers.snapshot().playerCount, 0);
  assert.deepEqual(anyPlayers.render(), onePlayer.render());
  assert.equal(anyPlayers.snapshot().requiredPlayers, onePlayer.snapshot().requiredPlayers);
});

test("game waits for a player and counts down before showing targets", () => {
  const firstTarget = helloWorldTargets()[0];
  const game = createGame({ playerCount: 1 });

  game.init(0);

  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().readyPlayers, 0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "starting");
  assert.ok((game.snapshot().countdownMillis ?? 0) > 0);
  game.tick({ atMillis: 2_100 });

  assert.equal(frameCell(game.render(), firstTarget.x - 1, firstTarget.y - 1)?.color, targetColor);
  assert.equal(game.snapshot().activeTargets, 2);
  assert.equal(game.snapshot().lives, helloWorldStartingLives);
});

test("the visible red tile costs one life, disappears, and advances deterministically", () => {
  const game = createGame({ playerCount: 1 });
  const hazards = helloWorldHazards();
  startGame(game);

  assert.deepEqual(game.snapshot().hazard, hazards[0]);
  assert.equal(frameCell(game.render(), hazards[0].x, hazards[0].y)?.color, hazardColor);

  const events = game.press({ ...hazards[0], pressed: true, atMillis: 2_200 });

  assert.equal(events[0]?.cue, "fail");
  assert.equal(events[0]?.message, "Vida perdida, quedan 2");
  assert.equal(game.snapshot().lives, 2);
  assert.equal(frameCell(game.render(), hazards[0].x, hazards[0].y)?.color, idleColor);
  assert.deepEqual(game.snapshot().hazard, hazards[1]);
  assert.equal(frameCell(game.render(), hazards[1].x, hazards[1].y)?.color, hazardColor);
});

test("completing the path celebrates for five seconds, ignores input, and restarts", () => {
  const game = createGame({ playerCount: 1 });
  startGame(game);

  helloWorldTargets().forEach((target, index) => {
    const events = game.press({ ...target, pressed: true, atMillis: 2_200 + index * 100 });
    assert.equal(game.snapshot().score, index + 1);
    assert.equal(events.length, 1);
  });

  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().score, helloWorldTargetScore);
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().celebrationMillis, helloWorldCelebrationMillis);
  const firstCelebrationFrame = game.render();

  game.press({ ...helloWorldHazards()[0], pressed: true, atMillis: 3_000 });
  game.tick({ atMillis: 3_200 });
  assert.equal(game.snapshot().lives, helloWorldStartingLives, "finished games must ignore hazards");
  assert.notDeepEqual(game.render(), firstCelebrationFrame, "the win floor animation must evolve with engine time");

  game.tick({ atMillis: 7_599 });
  assert.equal(game.snapshot().phase, "finished");
  const restartEvents = game.tick({ atMillis: 7_600 });
  assert.equal(restartEvents[0]?.message, "Esperando jugador");
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().score, 0);
  assert.equal(game.snapshot().lives, helloWorldStartingLives);
});

test("losing all lives celebrates for five seconds, ignores input, and restarts", () => {
  const game = createGame({ playerCount: 1 });
  startGame(game);

  helloWorldHazards().forEach((hazard, index) => {
    game.press({ ...hazard, pressed: true, atMillis: 2_200 + index * 100 });
  });

  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().lives, 0);
  assert.equal(game.snapshot().success, false);
  assert.equal(game.snapshot().lastEventMessage, "Sin vidas");
  assert.equal(game.snapshot().celebrationMillis, helloWorldCelebrationMillis);
  assert.equal(game.snapshot().hazard, undefined);
  const firstCelebrationFrame = game.render();

  game.press({ ...helloWorldTargets()[0], pressed: true, atMillis: 3_000 });
  game.tick({ atMillis: 3_200 });
  assert.equal(game.snapshot().score, 0, "finished games must ignore green targets");
  assert.notDeepEqual(game.render(), firstCelebrationFrame, "the loss floor animation must evolve with engine time");

  game.tick({ atMillis: 7_399 });
  assert.equal(game.snapshot().phase, "finished");
  game.tick({ atMillis: 7_400 });
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().lives, helloWorldStartingLives);
});

test("running out of time enters the same deterministic loss lifecycle", () => {
  const game = createGame({ playerCount: 1, durationMillis: 30_000 });
  startGame(game);

  const events = game.tick({ atMillis: 32_100 });

  assert.equal(events[0]?.cue, "fail");
  assert.equal(events[0]?.message, "Tiempo agotado");
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().lives, helloWorldStartingLives);
  assert.equal(game.snapshot().remainingMillis, 0);
});

test("fixtures and player display cover readiness, lives, and both results", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(startingSnapshot.phase, "starting");
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(damagedSnapshot.lives, 2);
  assert.equal(winningSnapshot.success, true);
  assert.equal(losingSnapshot.lives, 0);
  assert.notDeepEqual(winningFrame, losingFrame);

  const runningHtml = renderDisplay(runningSnapshot, runningFrame);
  const damagedHtml = renderDisplay(damagedSnapshot, damagedFrame);
  const winningHtml = renderDisplay(winningSnapshot, winningFrame);
  const losingHtml = renderDisplay(losingSnapshot, losingFrame);

  assert.match(runningHtml, /Hola Mundo/);
  assert.match(runningHtml, /ml-lives-meter/);
  assert.match(runningHtml, /Verde suma, rojo resta una vida/);
  assert.match(runningHtml, /Vidas/);
  assert.equal((runningHtml.match(/data-life-state="remaining"/g) ?? []).length, 3);
  assert.equal((damagedHtml.match(/data-life-state="remaining"/g) ?? []).length, 2);
  assert.equal((damagedHtml.match(/data-life-state="lost"/g) ?? []).length, 1);
  assert.match(winningHtml, /is-result-win/);
  assert.match(winningHtml, /¡Ganaste!/);
  assert.match(winningHtml, /Reinicio en 4/);
  assert.match(losingHtml, /is-result-lose/);
  assert.match(losingHtml, /Sin vidas/);
  assert.equal((losingHtml.match(/data-life-state="lost"/g) ?? []).length, 3);
  assert.doesNotMatch(runningHtml, /Score|Lives|Message/);
});

function renderDisplay(snapshot: typeof runningSnapshot, frame: typeof runningFrame): string {
  return renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot, frame }));
}

function startGame(game: ReturnType<typeof createGame>): void {
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
}
