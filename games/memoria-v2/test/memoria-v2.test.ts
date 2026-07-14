import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplay, createGame, manifest, memoriaV2MemorizeMillis, memoriaV2RoundWinMillis, memoriaV2StartingLives, memoryTargetsForLevel, memorizeFrame, memorizeSnapshot, roundWinSnapshot, runningSnapshot, waitingSnapshot } from "../src/index.ts";

function startRecall(game: ReturnType<typeof createGame>) {
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  game.tick({ atMillis: 2_100 + memoriaV2MemorizeMillis });
}

test("manifest describes the twenty-level Motion Go successor", () => {
  assert.equal(manifest.id, "memoria-v2");
  assert.equal(manifest.availability.production, true);
  assert.equal(manifest.players.allowAny, true);
});

test("levels generate deterministic, progressively denser figures", () => {
  assert.deepEqual(memoryTargetsForLevel(137, 8), memoryTargetsForLevel(137, 8));
  assert.ok(memoryTargetsForLevel(137, 1).length < memoryTargetsForLevel(137, 10).length);
});

test("memorize hides into recall and a completed figure pauses before advancing", () => {
  const game = createGame({ playerCount: 0, seed: 137 });
  startRecall(game);
  assert.equal(game.snapshot().memoryStage, "recall");
  const targets = game.snapshot().targets;
  targets.forEach((target, index) => game.press({ ...target, pressed: true, atMillis: 7_200 + index }));
  assert.equal(game.snapshot().memoryStage, "round-win");
  const score = game.snapshot().score;
  game.press({ x: 0, y: 0, pressed: true, atMillis: 7_500 });
  assert.equal(game.snapshot().score, score);
  game.tick({ atMillis: 7_200 + targets.length + memoriaV2RoundWinMillis });
  assert.equal(game.snapshot().level, 2);
  assert.equal(game.snapshot().memoryStage, "memorize");
});

test("three mistakes end the game with zero visible lives", () => {
  const game = createGame({ playerCount: 1, seed: 137 });
  startRecall(game);
  for (let index = 0; index < memoriaV2StartingLives; index += 1) game.press({ x: 0, y: 31, pressed: true, atMillis: 7_200 + index });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().memoryStage, "game-loss");
  assert.equal(game.snapshot().lives, 0);
  assert.equal(game.snapshot().success, false);
});

test("all twenty levels finish with a distinct game win", () => {
  const game = createGame({ playerCount: 1, seed: 137 });
  startRecall(game);
  let nowMillis = 7_100;
  for (let level = 1; level <= 20; level += 1) {
    for (const target of game.snapshot().targets) {
      nowMillis += 1;
      game.press({ ...target, pressed: true, atMillis: nowMillis });
    }
    if (level < 20) {
      nowMillis += memoriaV2RoundWinMillis;
      game.tick({ atMillis: nowMillis });
      nowMillis += memoriaV2MemorizeMillis;
      game.tick({ atMillis: nowMillis });
    }
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().memoryStage, "game-win");
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().level, 20);
});

test("fixtures and Spanish display cover waiting, memorize, recall, and round win", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(memorizeSnapshot.memoryStage, "memorize");
  assert.equal(runningSnapshot.memoryStage, "recall");
  assert.equal(roundWinSnapshot.memoryStage, "round-win");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: memorizeSnapshot, frame: memorizeFrame }));
  assert.match(html, /Nivel/);
  assert.match(html, /Aciertos/);
  assert.match(html, /Vidas/);
  assert.match(html, /ml-lives-meter/);
  assert.doesNotMatch(html, /Score|Lives|Message/);
});
