import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  frameCell,
  gameDifficultyOptions,
  gamePlayerCountOptions
} from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  damagedSnapshot,
  failedSnapshot,
  finishedFrame,
  finishedSnapshot,
  gameWinAnimationMillis,
  manifest,
  meteorDifficultyProfile,
  runningFrame,
  runningSnapshot,
  startingLives,
  type MeteorDodgeGameInstance
} from "../src/index.ts";

test("manifest declares a cooperative Any-player survival game", () => {
  assert.equal(manifest.id, "meteor-dodge");
  assert.equal(manifest.label, "Lluvia de meteoritos");
  assert.deepEqual(manifest.players, { allowAny: true, min: 1, max: 1 });
  assert.deepEqual(gamePlayerCountOptions(manifest), [0, 1]);
  assert.deepEqual(gameDifficultyOptions(manifest), ["easy", "medium", "hard", "expert"]);
  assert.equal(manifest.start.mode, "player-ready");
});

test("Any player mode preserves the same board and rules", () => {
  const anyPlayers = createGame({ playerCount: 0, seed: 137 });
  const onePlayer = createGame({ playerCount: 1, seed: 137 });
  anyPlayers.init(0);
  onePlayer.init(0);

  assert.equal(anyPlayers.snapshot().playerCount, 0);
  assert.deepEqual(anyPlayers.render(), onePlayer.render());
  assert.equal(anyPlayers.snapshot().requiredPlayers, 1);
  assert.equal(anyPlayers.snapshot().requiredPlayers, onePlayer.snapshot().requiredPlayers);
});

test("the central zone starts and can cancel the countdown", () => {
  const game = createGame({ playerCount: 1 });
  game.init(0);

  game.press({ x: 1, y: 1, pressed: true, atMillis: 50 });
  assert.equal(game.snapshot().phase, "waiting");

  const readyEvents = game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  assert.equal(readyEvents[0]?.message, "Zona lista");
  assert.equal(game.snapshot().phase, "starting");
  assert.ok((game.snapshot().countdownMillis ?? 0) > 0);

  game.release({ x: 8, y: 16, pressed: false, atMillis: 200 });
  const leftEvents = game.tick({ atMillis: 951 });
  assert.equal(leftEvents[0]?.message, "Vuelve a la zona azul");
  assert.equal(game.snapshot().phase, "waiting");
});

test("waiting and starting floors animate visibly", () => {
  const game = createGame({ playerCount: 1 });
  game.init(0);
  const waitingA = game.render();
  game.tick({ atMillis: 220 });
  const waitingB = game.render();
  assert.notDeepEqual(waitingA, waitingB);

  game.press({ x: 8, y: 16, pressed: true, atMillis: 300 });
  const startingA = game.render();
  game.tick({ atMillis: 450 });
  const startingB = game.render();
  assert.notDeepEqual(startingA, startingB);
});

test("meteors spawn deterministically and difficulty changes pressure", () => {
  const first = createStartedGame("hard", 77);
  const second = createStartedGame("hard", 77);
  first.tick({ atMillis: 7_000 });
  second.tick({ atMillis: 7_000 });
  assert.deepEqual(first.snapshot().meteors, second.snapshot().meteors);
  assert.deepEqual(first.render(), second.render());

  const easy = meteorDifficultyProfile("easy");
  const expert = meteorDifficultyProfile("expert");
  assert.ok(expert.intervalMillis < easy.intervalMillis);
  assert.ok(expert.warningMillis < easy.warningMillis);
  assert.ok(expert.radius > easy.radius);
});

test("standing in a blast costs one life and shows its impact", () => {
  const game = createStartedGame("medium", 137);
  const meteor = spawnFirstMeteor(game);
  game.press({ x: meteor.x, y: meteor.y, pressed: true, atMillis: meteor.impactAtMillis - 1 });
  const events = game.tick({ atMillis: meteor.impactAtMillis });

  assert.equal(events[0]?.message, "¡Impacto! Muévete");
  assert.equal(game.snapshot().lives, startingLives - 1);
  assert.equal(game.snapshot().meteors[0]?.result, "hit");
  assert.equal(frameCell(game.render(), meteor.x, meteor.y)?.color, "#ffffff");
});

test("moving out of a warning zone scores a dodge", () => {
  const game = createStartedGame("medium", 137);
  const meteor = spawnFirstMeteor(game);
  game.release({ x: 8, y: 16, pressed: false, atMillis: meteor.impactAtMillis - 1 });
  game.tick({ atMillis: meteor.impactAtMillis });

  assert.equal(game.snapshot().lives, startingLives);
  assert.equal(game.snapshot().dodgedMeteors, 1);
  assert.equal(game.snapshot().meteors[0]?.result, "dodged");
});

test("overlapping danger cannot remove several lives inside the recovery window", () => {
  const game = createStartedGame("expert", 91);
  const first = spawnFirstMeteor(game);
  game.release({ x: 8, y: 16, pressed: false, atMillis: first.impactAtMillis - 2 });
  game.press({ x: first.x, y: first.y, pressed: true, atMillis: first.impactAtMillis - 1 });
  game.tick({ atMillis: first.impactAtMillis });
  const livesAfterHit = game.snapshot().lives;
  game.release({ x: first.x, y: first.y, pressed: false, atMillis: first.impactAtMillis + 1 });

  game.tick({ atMillis: first.impactAtMillis + 100 });
  const second = game.snapshot().meteors.find((meteor) => meteor.result === "pending" && meteor.id !== first.id);
  assert.ok(second);
  assert.ok(second.impactAtMillis - first.impactAtMillis < 1_000);
  game.press({ x: second.x, y: second.y, pressed: true, atMillis: second.impactAtMillis - 1 });
  game.tick({ atMillis: second.impactAtMillis });

  assert.equal(game.snapshot().lives, livesAfterHit);
  assert.equal(game.snapshot().meteors.find((meteor) => meteor.id === second.id)?.result, "protected");
});

test("surviving the timer enters a deterministic game-win animation", () => {
  const game = createGame({ playerCount: 1, durationMillis: 1_000, seed: 137 });
  startGame(game);
  game.release({ x: 8, y: 16, pressed: false, atMillis: 2_150 });
  const events = game.tick({ atMillis: 3_100 });

  assert.equal(events.at(-1)?.message, "Tormenta superada");
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().celebrating, true);
  const firstFrame = game.render();

  game.tick({ atMillis: 3_700 });
  const secondFrame = game.render();
  assert.notDeepEqual(firstFrame, secondFrame);
  assert.equal(game.snapshot().celebrationMillis, 600);

  const score = game.snapshot().score;
  game.press({ x: 4, y: 4, pressed: true, atMillis: 3_800 });
  assert.equal(game.snapshot().score, score);
  assert.equal(game.snapshot().phase, "finished");

  game.tick({ atMillis: 3_100 + gameWinAnimationMillis });
  assert.equal(game.snapshot().celebrating, false);
});

test("three separated impacts end the game with zero lives", () => {
  const game = createStartedGame("easy", 137);
  let nowMillis = 2_450;

  for (let hit = 0; hit < startingLives; hit += 1) {
    game.tick({ atMillis: nowMillis });
    const meteor = game.snapshot().meteors.find((candidate) => candidate.result === "pending");
    assert.ok(meteor);
    game.release({ x: 8, y: 16, pressed: false, atMillis: meteor.impactAtMillis - 2 });
    game.press({ x: meteor.x, y: meteor.y, pressed: true, atMillis: meteor.impactAtMillis - 1 });
    game.tick({ atMillis: meteor.impactAtMillis });
    game.release({ x: meteor.x, y: meteor.y, pressed: false, atMillis: meteor.impactAtMillis + 1 });
    nowMillis = meteor.impactAtMillis + 1_100;
  }

  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, false);
  assert.equal(game.snapshot().lives, 0);
  assert.equal(game.snapshot().lastEventMessage, "Sin vidas");
});

test("fixtures and the Spanish display cover full, partial, and zero lives", () => {
  assert.equal(runningFrame.width, FLOOR_COLS);
  assert.equal(runningFrame.height, FLOOR_ROWS);
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(damagedSnapshot.lives, 2);
  assert.equal(failedSnapshot.lives, 0);
  assert.equal(finishedSnapshot.phase, "finished");
  assert.equal(finishedSnapshot.success, true);
  assert.equal(finishedFrame.width, FLOOR_COLS);

  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: runningSnapshot,
    frame: runningFrame
  }));
  const damagedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: damagedSnapshot,
    frame: runningFrame
  }));
  const failedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: failedSnapshot,
    frame: runningFrame
  }));

  assert.match(html, /Lluvia de meteoritos/);
  assert.match(html, /Esquivados/);
  assert.match(html, /Vidas/);
  assert.match(html, /Tiempo/);
  assert.match(html, /Tormenta en el suelo/);
  assert.equal((html.match(/data-life-state="remaining"/g) ?? []).length, 3);
  assert.equal((damagedHtml.match(/data-life-state="remaining"/g) ?? []).length, 2);
  assert.equal((damagedHtml.match(/data-life-state="lost"/g) ?? []).length, 1);
  assert.equal((failedHtml.match(/data-life-state="lost"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Score|Lives|Time|Message/);
});

function createStartedGame(difficulty: string, seed: number): MeteorDodgeGameInstance {
  const game = createGame({ difficulty, playerCount: 1, seed });
  startGame(game);
  return game;
}

function spawnFirstMeteor(game: MeteorDodgeGameInstance) {
  game.tick({ atMillis: 2_450 });
  const meteor = game.snapshot().meteors[0];
  assert.ok(meteor);
  return meteor;
}

function startGame(game: MeteorDodgeGameInstance): void {
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  assert.equal(game.snapshot().phase, "running");
}
