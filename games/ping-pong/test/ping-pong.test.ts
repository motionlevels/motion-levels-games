import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_COLS, FLOOR_ROWS, frameCell, type Frame } from "@motion-levels-games/game-sdk";
import { PlayerDisplay, ballColor, createGame, manifest, runningFrame, runningSnapshot, waitingSnapshot } from "../src/index.ts";

function countColor(frame: Frame, color: string): number {
  return frame.cells.filter((cell) => cell.color === color).length;
}

function startGame() {
  const game = createGame({
    seed: 7,
    playerCount: 2,
    difficulty: "hard",
    options: { points_to_win: 1 }
  });
  game.init(0);
  return game;
}

test("manifest exposes renamed Ping Pong game", () => {
  assert.equal(manifest.id, "ping-pong");
  assert.equal(manifest.label, "Ping Pong");
  assert.deepEqual(manifest.players, { allowAny: true, min: 2, max: 2 });
});

test("supports arbitrary configured player counts while rendering two teams", () => {
  const game = createGame({
    seed: 7,
    playerCount: 5,
    players: [
      { name: "Chris" },
      { name: "Jose" },
      { name: "Ana" },
      { name: "Luis" },
      { name: "Marta" }
    ]
  });

  game.init(0);
  const snapshot = game.snapshot();

  assert.equal(snapshot.playerCount, 5);
  assert.equal(snapshot.players.length, 2);
  assert.equal(snapshot.players[0]?.label, "Rojo");
  assert.equal(snapshot.players[1]?.label, "Azul");
});

test("readiness waits for both floor halves with release grace", () => {
  const game = startGame();

  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().activeTargets, 0);
  assert.deepEqual(game.press({ x: 0, y: 4, pressed: true, atMillis: 100 }), []);
  assert.equal(game.snapshot().activeTargets, 1);
  assert.deepEqual(game.release({ x: 0, y: 4, pressed: false, atMillis: 200 }), []);
  assert.equal(game.snapshot().activeTargets, 1);

  const events = game.press({ x: 0, y: FLOOR_ROWS - 5, pressed: true, atMillis: 700 });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.cue, "start");
  assert.equal(game.snapshot().phase, "starting");
  assert.ok((game.snapshot().countdownMillis ?? 0) > 0);
});

test("countdown enters running phase and renders a single visible ball", () => {
  const game = startGame();

  game.press({ x: 0, y: 4, pressed: true, atMillis: 100 });
  game.press({ x: 0, y: FLOOR_ROWS - 5, pressed: true, atMillis: 200 });
  game.tick({ atMillis: 2300 });

  const snapshot = game.snapshot();
  const frame = game.render();

  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.matchTarget, 1);
  assert.equal(frame.width, FLOOR_COLS);
  assert.equal(frame.height, FLOOR_ROWS);
  assert.equal(countColor(frame, ballColor), 1);
});

test("one-point game finishes and auto-resets after win animation", () => {
  const game = startGame();

  game.press({ x: 0, y: 4, pressed: true, atMillis: 100 });
  game.press({ x: 0, y: FLOOR_ROWS - 5, pressed: true, atMillis: 200 });
  game.tick({ atMillis: 2300 });

  let finishedAt = 0;
  for (let atMillis = 2400; atMillis <= 20_000; atMillis += 100) {
    game.tick({ atMillis });
    if (game.snapshot().phase === "finished") {
      finishedAt = atMillis;
      break;
    }
  }

  assert.ok(finishedAt > 0, "game should finish after a one-point score window");
  assert.equal(game.snapshot().score, 1);

  game.tick({ atMillis: finishedAt + 3100 });

  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().score, 0);
});

test("fixtures and display render score state", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  assert.equal(frameCell(runningFrame, 8, 16)?.color, ballColor);

  const waitingHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: waitingSnapshot,
      frame: runningFrame
    })
  );
  assert.match(waitingHtml, /Ready/);
  assert.match(waitingHtml, /0\/2/);

  const html = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: runningSnapshot,
      frame: runningFrame
    })
  );

  assert.match(html, /Ping Pong/);
  assert.match(html, /Rally/);
  assert.match(html, /Round/);
  assert.match(html, /1\/9/);
  assert.doesNotMatch(html, /Ready/);
  assert.doesNotMatch(html, /2\/2/);
});
