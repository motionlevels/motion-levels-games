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
  manifest,
  resetSnapshot,
  roundWinSnapshot,
  runningFrame,
  runningSnapshot,
  sueloSeguroDamageImmunityMillis,
  sueloSeguroDifficultyProfile,
  sueloSeguroHazardOrigin,
  sueloSeguroHazardSize,
  sueloSeguroPlatformAnchors,
  sueloSeguroRequiredTransfers,
  sueloSeguroRoundWinMillis,
  sueloSeguroStartingPlatforms,
  sueloSeguroTurnFailMillis
} from "../src/index.ts";

function startGame(playerCount: number, difficulty = "medium") {
  const game = createGame({ playerCount, difficulty, durationMillis: manifest.defaultDurationMillis, seed: 137 });
  game.init(0);
  sueloSeguroStartingPlatforms(playerCount).forEach((platform, index) => {
    game.press({ x: platform.x, y: platform.y, pressed: true, atMillis: 100 + index * 70 });
  });
  game.tick({ atMillis: 2_700 });
  return game;
}

function onBorder(platform: { x: number; y: number }): boolean {
  return platform.x === 0 || platform.x === 14 || platform.y === 0 || platform.y === 30;
}

function touchesOrAdjacent(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
  return left.x <= right.x + 2 && left.x + 2 >= right.x && left.y <= right.y + 2 && left.y + 2 >= right.y;
}

test("manifest publishes an exact one-to-eight player cooperative game", () => {
  assert.equal(manifest.id, "suelo-seguro");
  assert.equal(manifest.availability.production, true);
  assert.equal(manifest.players.allowAny, false);
  assert.deepEqual([manifest.players.min, manifest.players.max], [1, 8]);
  assert.equal(manifest.start.mode, "player-ready");
  assert.equal(manifest.start.releaseGraceMillis, 1_500);
});

test("every supported player count starts from separated border platforms", () => {
  assert.ok(sueloSeguroPlatformAnchors.every(onBorder));
  for (let playerCount = 1; playerCount <= 8; playerCount += 1) {
    const starts = sueloSeguroStartingPlatforms(playerCount);
    assert.equal(new Set(starts.map((platform) => `${platform.x},${platform.y}`)).size, playerCount);
    assert.ok(starts.every(onBorder));
    starts.forEach((left, leftIndex) => starts.slice(leftIndex + 1).forEach((right) => assert.equal(touchesOrAdjacent(left, right), false)));
    const game = startGame(playerCount);
    const snapshot = game.snapshot();
    assert.equal(snapshot.phase, "running");
    assert.equal(snapshot.playerCount, playerCount);
    assert.equal(snapshot.requiredPlayers, playerCount);
    assert.equal(snapshot.platforms.length, playerCount);
    assert.equal(snapshot.targetPlatform?.ownerIndex, 0);
    assert.equal(snapshot.players[0]?.label, "Jugador 1");
    assert.ok(snapshot.platforms.every(onBorder));
    snapshot.platforms.forEach((left, leftIndex) => snapshot.platforms.slice(leftIndex + 1).forEach((right) => assert.equal(touchesOrAdjacent(left, right), false)));
  }
});

test("the active platform disappears and a distant target of the same color replaces it", () => {
  const game = startGame(4);
  const snapshot = game.snapshot();
  const oldPlatform = sueloSeguroStartingPlatforms(4)[0]!;
  const target = snapshot.targetPlatform;
  assert.ok(target);
  assert.equal(snapshot.platforms.some((platform) => platform.x === oldPlatform.x && platform.y === oldPlatform.y), false);
  assert.equal(target.color, snapshot.players[0]?.color);
  assert.equal(onBorder(target), true);
  snapshot.platforms.filter((platform) => platform.ownerIndex !== target.ownerIndex).forEach((platform) => assert.equal(touchesOrAdjacent(platform, target), false));
  assert.ok(Math.abs(target.x - oldPlatform.x) + Math.abs(target.y - oldPlatform.y) >= 8);
});

test("the red eight-by-eight block follows a deterministic clockwise orbit", () => {
  const left = startGame(3, "hard");
  const right = startGame(3, "hard");
  assert.deepEqual(left.render(), right.render());
  assert.equal(sueloSeguroHazardSize, 8);
  assert.deepEqual(sueloSeguroHazardOrigin(0), { x: 0, y: 0 });
  assert.deepEqual(sueloSeguroHazardOrigin(8), { x: 8, y: 0 });
  assert.deepEqual(sueloSeguroHazardOrigin(9), { x: 8, y: 1 });
  const origin = sueloSeguroHazardOrigin(left.snapshot().hazardStep);
  const redCells = left.render().cells.filter((cell) => cell.color === "#ff183d");
  assert.ok(redCells.length > 0 && redCells.length <= sueloSeguroHazardSize ** 2);
  assert.ok(redCells.every((cell) => cell.x >= origin.x && cell.x < origin.x + sueloSeguroHazardSize && cell.y >= origin.y && cell.y < origin.y + sueloSeguroHazardSize));
  const before = left.render().cells.map((cell) => cell.color);
  left.tick({ atMillis: 2_700 + sueloSeguroDifficultyProfile("hard").hazardStepMillis });
  const after = left.render().cells.map((cell) => cell.color);
  assert.notDeepEqual(after, before);
  assert.equal(left.snapshot().hazardStep, right.snapshot().hazardStep + 1);
  assert.ok(sueloSeguroDifficultyProfile("expert").hazardStepMillis < sueloSeguroDifficultyProfile("easy").hazardStepMillis);
});

test("reaching the target adds relay time to the cooperative lower-is-better score", () => {
  const game = startGame(3);
  const target = game.snapshot().targetPlatform!;
  game.press({ x: target.x, y: target.y, pressed: true, atMillis: 2_800 });
  const scored = game.snapshot();
  assert.equal(scored.phase, "round-win");
  assert.equal(scored.completedTransfers, 1);
  assert.equal(scored.lastTransferMillis, 100);
  assert.equal(scored.bestTransferMillis, 100);
  assert.equal(scored.teamTransferMillis, 100);
  assert.equal(scored.score, 100);
  assert.equal(scored.players[0]?.score, 100);
  game.press({ x: 0, y: 0, pressed: true, atMillis: 2_900 });
  assert.equal(game.snapshot().completedTransfers, 1);
  game.release({ x: target.x, y: target.y, pressed: false, atMillis: 2_820 });
  game.tick({ atMillis: 2_800 + sueloSeguroRoundWinMillis - 1 });
  assert.equal(game.snapshot().phase, "round-win");
  assert.equal(game.snapshot().activePlayerIndex, 0);
  game.tick({ atMillis: 2_800 + sueloSeguroRoundWinMillis });
  assert.equal(game.snapshot().phase, "running");
  assert.equal(game.snapshot().activePlayerIndex, 1);
  assert.equal(game.snapshot().targetPlatform?.ownerIndex, 1);
});

test("the same relay count ranks a faster team ahead", () => {
  const fast = startGame(2);
  const slow = startGame(2);
  const fastTarget = fast.snapshot().targetPlatform!;
  const slowTarget = slow.snapshot().targetPlatform!;
  fast.press({ x: fastTarget.x, y: fastTarget.y, pressed: true, atMillis: 2_800 });
  slow.press({ x: slowTarget.x, y: slowTarget.y, pressed: true, atMillis: 3_200 });
  assert.equal(fast.snapshot().completedTransfers, slow.snapshot().completedTransfers);
  assert.ok(fast.snapshot().score < slow.snapshot().score);
});

test("a missed turn consumes a life, moves the platform, and advances play", () => {
  const game = startGame(2);
  const before = game.snapshot();
  const target = before.targetPlatform!;
  game.tick({ atMillis: 2_700 + before.turnDurationMillis });
  assert.equal(game.snapshot().phase, "turn-fail");
  assert.equal(game.snapshot().lives, before.lives - 1);
  assert.equal(game.snapshot().failedTurns, 1);
  assert.equal(game.snapshot().platforms.some((platform) => platform.x === target.x && platform.y === target.y), true);
  game.tick({ atMillis: 2_700 + before.turnDurationMillis + sueloSeguroTurnFailMillis });
  assert.equal(game.snapshot().activePlayerIndex, 1);
  assert.equal(game.snapshot().phase, "running");
});

test("touching moving red tiles costs one shared life with damage immunity", () => {
  const game = startGame(1, "medium");
  game.tick({ atMillis: 3_500 });
  const firstDanger = game.render().cells.find((cell) => cell.color === "#ff183d" && !game.snapshot().platforms.some((platform) => cell.x >= platform.x && cell.x < platform.x + 2 && cell.y >= platform.y && cell.y < platform.y + 2));
  assert.ok(firstDanger);
  const initialLives = game.snapshot().lives;
  game.press({ x: firstDanger.x, y: firstDanger.y, pressed: true, atMillis: 3_500 });
  assert.equal(game.snapshot().lives, initialLives - 1);
  game.release({ x: firstDanger.x, y: firstDanger.y, pressed: false, atMillis: 3_510 });
  const secondDanger = game.render().cells.find((cell) => cell.color === "#ff183d" && cell.x !== firstDanger.x);
  assert.ok(secondDanger);
  game.press({ x: secondDanger.x, y: secondDanger.y, pressed: true, atMillis: 3_500 + sueloSeguroDamageImmunityMillis - 1 });
  assert.equal(game.snapshot().lives, initialLives - 1);
});

test("completing the relay target starts the distinct final victory", () => {
  const game = startGame(4);
  let clock = 2_800;
  while (game.snapshot().phase !== "finished") {
    const target = game.snapshot().targetPlatform;
    assert.ok(target);
    game.press({ x: target.x, y: target.y, pressed: true, atMillis: clock });
    game.release({ x: target.x, y: target.y, pressed: false, atMillis: clock + 10 });
    if (game.snapshot().phase !== "finished") {
      clock += sueloSeguroRoundWinMillis + 20;
      game.tick({ atMillis: clock });
      clock += 20;
    }
  }
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().completedTransfers, sueloSeguroRequiredTransfers(4));
  assert.equal(game.snapshot().players.reduce((score, player) => score + player.score, 0), game.snapshot().teamTransferMillis);
  assert.equal(game.snapshot().score, game.snapshot().teamTransferMillis);
});

test("fixtures and Spanish display cover movement, damage, round win, reset, and victory", () => {
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(damagedSnapshot.lives, damagedSnapshot.maxLives - 1);
  assert.equal(roundWinSnapshot.phase, "round-win");
  assert.equal(finishedSnapshot.success, true);
  assert.equal(failedSnapshot.lives, 0);
  assert.equal(failedSnapshot.success, false);
  assert.equal(resetSnapshot.phase, "waiting");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  assert.match(html, /Turno de/);
  assert.match(html, /Relevos seguros/);
  assert.match(html, /Vidas del equipo/);
  assert.match(html, /Tiempo del equipo/);
  assert.match(html, /Menos es mejor/);
  assert.match(html, /Pista en movimiento/);
  assert.doesNotMatch(html, /Player|Lives|Score|Waiting/);
  const damagedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: damagedSnapshot }));
  assert.match(damagedHtml, /Una vida menos/);
  assert.match(damagedHtml, /para todo el equipo/);
  const failedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: failedSnapshot }));
  assert.match(failedHtml, /El rojo os alcanzó/);
  assert.match(failedHtml, /data-life-state="lost"/);
});
