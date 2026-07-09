import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_COLS, FLOOR_ROWS, gameDifficultyOptions, gamePlayerCountOptions } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  brickColors,
  createGame,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  type ArkanoidGameInstance
} from "../src/index.ts";

test("manifest exposes a strict one-player Arkanoid game", () => {
  assert.equal(manifest.id, "arkanoid");
  assert.equal(manifest.label, "Arkanoid");
  assert.deepEqual(gamePlayerCountOptions(manifest), [1]);
  assert.deepEqual(gameDifficultyOptions(manifest), ["easy", "medium", "hard", "expert"]);
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

test("difficulty changes ball speed through deterministic movement", () => {
  const easy = createStartedGame("easy");
  const expert = createStartedGame("expert");

  easy.tick({ atMillis: 3_400 });
  expert.tick({ atMillis: 3_400 });

  assert.ok(expert.snapshot().ballMoves > easy.snapshot().ballMoves);
  assert.ok(expert.snapshot().ballSpeed > easy.snapshot().ballSpeed);
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

function createStartedGame(difficulty: string, seed = 137): ArkanoidGameInstance {
  const game = createGame({ difficulty, playerCount: 1, seed });
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
