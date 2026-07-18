import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlayerDisplay,
  createGame,
  equilibrioChallenges,
  equilibrioDifficultyProfile,
  equilibrioRoundWinMillis,
  finishedSnapshot,
  holdingSnapshot,
  manifest,
  roundWinSnapshot,
  runningSnapshot
} from "../src/index.ts";

function startGame(playerCount = 0, difficulty = "medium") {
  const game = createGame({ playerCount, difficulty, durationMillis: manifest.defaultDurationMillis });
  game.init(0);
  game.press({ x: 4, y: 16, pressed: true, atMillis: 100 });
  game.press({ x: 11, y: 16, pressed: true, atMillis: 180 });
  game.tick({ atMillis: 2_180 });
  game.release({ x: 4, y: 16, pressed: false, atMillis: 2_200 });
  game.release({ x: 11, y: 16, pressed: false, atMillis: 2_210 });
  return game;
}

test("manifest exposes a production cooperative Any or two-to-eight player game", () => {
  assert.equal(manifest.id, "equilibrio");
  assert.equal(manifest.availability.production, true);
  assert.equal(manifest.players.allowAny, true);
  assert.deepEqual([manifest.players.min, manifest.players.max], [2, 8]);
  assert.equal(manifest.start.mode, "player-ready");
});

test("two real zones are required and release grace cancels a departed side", () => {
  const game = createGame({ playerCount: 8 });
  game.init(0);
  game.press({ x: 4, y: 16, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: 11, y: 16, pressed: true, atMillis: 200 });
  assert.equal(game.snapshot().phase, "starting");
  assert.equal(game.snapshot().requiredPlayers, 2);
  game.release({ x: 11, y: 16, pressed: false, atMillis: 300 });
  game.tick({ atMillis: 1_900 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("both challenge pads must stay occupied through the configured hold", () => {
  const game = startGame();
  const challenge = equilibrioChallenges[0]!;
  game.press({ x: challenge.left.minX, y: challenge.left.minY, pressed: true, atMillis: 2_300 });
  game.tick({ atMillis: 4_500 });
  assert.equal(game.snapshot().phase, "running");
  assert.equal(game.snapshot().holdMillis, 0);
  game.press({ x: challenge.right.minX, y: challenge.right.minY, pressed: true, atMillis: 4_550 });
  game.tick({ atMillis: 4_550 + equilibrioDifficultyProfile("medium").holdMillis });
  assert.equal(game.snapshot().phase, "round-win");
  assert.equal(game.snapshot().score, 1);
});

test("wrong tiles reduce stability and lock failure at zero", () => {
  const game = startGame(2, "expert");
  for (let index = 0; index < 5; index += 1) {
    game.press({ x: 7, y: index, pressed: true, atMillis: 2_300 + index * 20 });
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().stability, 0);
  assert.equal(game.snapshot().success, false);
  const score = game.snapshot().score;
  game.press({ x: 1, y: 4, pressed: true, atMillis: 3_000 });
  assert.equal(game.snapshot().score, score);
});

test("all five deterministic rounds lead to the distinct game-win state", () => {
  const game = startGame();
  let clock = 2_300;
  for (const challenge of equilibrioChallenges) {
    game.press({ x: challenge.left.minX, y: challenge.left.minY, pressed: true, atMillis: clock });
    game.press({ x: challenge.right.minX, y: challenge.right.minY, pressed: true, atMillis: clock + 50 });
    clock += equilibrioDifficultyProfile("medium").holdMillis + 50;
    game.tick({ atMillis: clock });
    if (game.snapshot().phase === "round-win") {
      clock += equilibrioRoundWinMillis;
      game.tick({ atMillis: clock });
    }
    clock += 50;
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().score, equilibrioChallenges.length);
});

test("difficulty changes hold time and fixtures cover running, holding, round, and game wins", () => {
  assert.ok(equilibrioDifficultyProfile("expert").holdMillis > equilibrioDifficultyProfile("easy").holdMillis);
  assert.equal(runningSnapshot.stage, "balancing");
  assert.ok(holdingSnapshot.holdMillis > 0);
  assert.equal(roundWinSnapshot.stage, "round-win");
  assert.equal(finishedSnapshot.stage, "game-win");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: holdingSnapshot }));
  assert.match(html, /Estabilidad/);
  assert.match(html, /Mantén las dos plataformas/);
  assert.doesNotMatch(html, /Stability|Waiting|Player/);
});
