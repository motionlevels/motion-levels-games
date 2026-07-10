import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  gameDifficultyOptions,
  gamePlayerCountOptions,
  normalizeGameConfig
} from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  arkanoidConfigVars,
  brickColors,
  createGame,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  type ArkanoidGameInstance
} from "../src/index.ts";

test("manifest exposes turn-friendly Any or one-player Arkanoid", () => {
  assert.equal(manifest.id, "arkanoid");
  assert.equal(manifest.label, "Arkanoid");
  assert.deepEqual(manifest.players, { allowAny: true, min: 1, max: 1 });
  assert.deepEqual(gamePlayerCountOptions(manifest), [0, 1]);
  assert.deepEqual(gameDifficultyOptions(manifest), ["easy", "medium", "hard", "expert"]);
  assert.deepEqual(manifest.config?.vars, Object.values(arkanoidConfigVars));
  assert.equal(arkanoidConfigVars.ballSpeed.playerFacing, true);
});

test("Any player mode preserves the same Arkanoid board and rules", () => {
  const anyPlayers = createGame({ playerCount: 0, seed: 137 });
  const onePlayer = createGame({ playerCount: 1, seed: 137 });

  anyPlayers.init(0);
  onePlayer.init(0);

  assert.equal(anyPlayers.snapshot().playerCount, 0);
  assert.deepEqual(anyPlayers.render(), onePlayer.render());
  assert.equal(anyPlayers.snapshot().requiredPlayers, onePlayer.snapshot().requiredPlayers);
});

test("waiting floor shows the complete brick wall and player detection zone", () => {
  const game = createGame({ playerCount: 1 });
  const events = game.init(0);
  const frame = game.render();
  const brickCells = frame.cells.filter((cell) => brickColors.includes(cell.color)).length;

  assert.equal(events[0]?.message, "Esperando jugador abajo");
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().readyPlayers, 0);
  assert.equal(game.snapshot().requiredPlayers, 1);
  assert.equal(game.snapshot().totalBricks, 32);
  assert.equal(game.snapshot().bricksRemaining, 32);
  assert.equal(brickCells, 64);
  assert.equal(frame.width, FLOOR_COLS);
  assert.equal(frame.height, FLOOR_ROWS);
});

test("only the lower control zone detects the player and starts a countdown", () => {
  const game = createGame({ playerCount: 1 });
  game.init(0);

  assert.deepEqual(game.press({ x: 2, y: 12, pressed: true, atMillis: 50 }), []);
  assert.equal(game.snapshot().phase, "waiting");

  const events = game.press({ x: 14, y: 30, pressed: true, atMillis: 100 });
  assert.equal(events[0]?.message, "Jugador listo");
  assert.equal(game.snapshot().phase, "starting");
  assert.equal(game.snapshot().paddleX, 11);
  assert.equal(game.snapshot().ball.x, 13);

  game.tick({ atMillis: 2_100 });
  assert.equal(game.snapshot().phase, "running");
  assert.equal(game.snapshot().lastEventMessage, "Pelota en juego");
});

test("manifest owns ball speed normalization", () => {
  const belowRange = normalizeGameConfig({ options: { ball_speed: -100 } }, manifest);
  const aboveRange = normalizeGameConfig({ options: { ball_speed: 100 } }, manifest);

  assert.equal(belowRange.options.ball_speed, arkanoidConfigVars.ballSpeed.min);
  assert.equal(aboveRange.options.ball_speed, arkanoidConfigVars.ballSpeed.max);
  assert.equal(
    normalizeGameConfig({}, manifest).options.ball_speed,
    arkanoidConfigVars.ballSpeed.default
  );
});

test("configured ball speed is amplified by difficulty", () => {
  const easy = createStartedGame("easy", 137, 4);
  const expert = createStartedGame("expert", 137, 4);
  const fasterEasy = createStartedGame("easy", 137, 8);

  easy.tick({ atMillis: 3_400 });
  expert.tick({ atMillis: 3_400 });
  fasterEasy.tick({ atMillis: 3_400 });

  assert.ok(expert.snapshot().ballMoves > easy.snapshot().ballMoves);
  assert.ok(expert.snapshot().ballSpeed > easy.snapshot().ballSpeed);
  assert.ok(fasterEasy.snapshot().ballMoves > easy.snapshot().ballMoves);
  assert.equal(fasterEasy.snapshot().ballSpeed, easy.snapshot().ballSpeed * 2);
});

test("leaving the control zone cancels the pre-start countdown", () => {
  const game = createGame({ playerCount: 1 });
  game.init(0);
  game.press({ x: 7, y: 30, pressed: true, atMillis: 100 });
  game.release({ x: 7, y: 30, pressed: false, atMillis: 200 });

  const events = game.tick({ atMillis: 851 });
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(events[0]?.message, "Vuelve a la zona iluminada");
});

test("tracked paddle play destroys bricks without losing a life", () => {
  const game = createStartedGame("medium");
  advanceWithTracking(game, 8_000);
  const snapshot = game.snapshot();

  assert.ok(snapshot.score > 0);
  assert.ok(snapshot.bricksRemaining < snapshot.totalBricks);
  assert.equal(snapshot.lives, 3);
  assert.equal(snapshot.maxLives, 3);
});

test("moving away from the ball eventually costs a life", () => {
  const game = createStartedGame("expert");
  let nowMillis = 2_150;
  for (let step = 0; step < 2_000 && game.snapshot().lives === 3; step += 1) {
    const ballX = game.snapshot().ball.x;
    game.press({ x: ballX < FLOOR_COLS / 2 ? FLOOR_COLS - 1 : 0, y: 30, pressed: true, atMillis: nowMillis });
    game.tick({ atMillis: nowMillis });
    nowMillis += 50;
  }

  assert.equal(game.snapshot().lives, 2);
  assert.equal(game.snapshot().phase, "ready");
  assert.equal(game.snapshot().lastEventMessage, "Vida perdida, pisa abajo para lanzar");
});

test("same seed and input sequence produce the same state", () => {
  const first = createStartedGame("hard", 77);
  const second = createStartedGame("hard", 77);
  advanceWithTracking(first, 1_200);
  advanceWithTracking(second, 1_200);

  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.deepEqual(first.render(), second.render());
});

test("fixtures and Spanish player display render the game state", () => {
  assert.equal(runningFrame.width, FLOOR_COLS);
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(finishedSnapshot.phase, "finished");
  assert.equal(finishedSnapshot.success, true);

  const html = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: runningSnapshot,
      frame: runningFrame
    })
  );
  const lostLifeHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: { ...runningSnapshot, lives: 2 },
      frame: runningFrame
    })
  );

  assert.match(html, /Arkanoid/);
  assert.match(html, /Bloques/);
  assert.match(html, /Vidas/);
  assert.match(html, /ml-lives-meter/);
  assert.equal((html.match(/data-life-state="remaining"/g) ?? []).length, 3);
  assert.equal((lostLifeHtml.match(/data-life-state="remaining"/g) ?? []).length, 2);
  assert.equal((lostLifeHtml.match(/data-life-state="lost"/g) ?? []).length, 1);
  assert.match(html, /Juego en el suelo/);
  assert.doesNotMatch(html, /Score|Lives|Message/);
});

function createStartedGame(difficulty: string, seed = 137, ballSpeed?: number): ArkanoidGameInstance {
  const game = createGame({
    difficulty,
    options: ballSpeed === undefined ? undefined : { ball_speed: ballSpeed },
    playerCount: 1,
    seed
  });
  game.init(0);
  game.press({ x: 7, y: 30, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  return game;
}

function advanceWithTracking(game: ArkanoidGameInstance, durationMillis: number): void {
  for (let nowMillis = 2_150; nowMillis <= 2_100 + durationMillis; nowMillis += 50) {
    const snapshot = game.snapshot();
    if (snapshot.phase === "finished") {
      return;
    }
    game.press({ x: snapshot.ball.x, y: 30, pressed: true, atMillis: nowMillis });
    game.tick({ atMillis: nowMillis });
  }
}
