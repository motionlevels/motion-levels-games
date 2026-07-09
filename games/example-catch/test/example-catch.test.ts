import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_COLS, FLOOR_ROWS, type Frame } from "@motion-levels-games/game-sdk";
import { PlayerDisplay, createGame, finishedSnapshot, manifest, runningFrame, runningSnapshot, targetColor } from "../src/index.ts";

function findTarget(frame: Frame) {
  const target = frame.cells.find((cell) => cell.color === targetColor);

  assert.ok(target, "target should be visible");
  return target;
}

test("initial target appears within 16x32 bounds", () => {
  const game = createGame({ seed: 10, playerCount: 1 });
  game.init(0);
  const target = findTarget(game.render());

  assert.ok(target.x >= 0 && target.x < FLOOR_COLS);
  assert.ok(target.y >= 0 && target.y < FLOOR_ROWS);
});

test("pressing the target increments score and moves target", () => {
  const game = createGame({ seed: 25, playerCount: 1 });
  game.init(0);
  const target = findTarget(game.render());

  game.press({ x: target.x, y: target.y, pressed: true, atMillis: 100 });

  const nextTarget = findTarget(game.render());
  assert.equal(game.snapshot().score, 1);
  assert.notDeepEqual([nextTarget.x, nextTarget.y], [target.x, target.y]);
});

test("pressing a non-target does not increment score", () => {
  const game = createGame({ seed: 36, playerCount: 1 });
  game.init(0);
  const target = findTarget(game.render());
  const missX = (target.x + 1) % FLOOR_COLS;

  game.press({ x: missX, y: target.y, pressed: true, atMillis: 100 });

  assert.equal(game.snapshot().score, 0);
});

test("countdown reaches finished", () => {
  const game = createGame({ seed: 44, playerCount: 1, durationMillis: 500 });
  game.init(0);

  game.tick({ atMillis: 500 });

  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().remainingMillis, 0);
});

test("same seed produces same target sequence", () => {
  function sequence(seed: number) {
    const game = createGame({ seed, playerCount: 1 });
    game.init(0);

    return Array.from({ length: 6 }, (_, index) => {
      const target = findTarget(game.render());
      game.press({ x: target.x, y: target.y, pressed: true, atMillis: index * 100 });
      return `${target.x},${target.y}`;
    });
  }

  assert.deepEqual(sequence(1_234), sequence(1_234));
});

test("snapshot fixtures match the manifest and display renders them", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  assert.equal(finishedSnapshot.currentGame, manifest.id);

  const html = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: runningSnapshot,
      frame: runningFrame
    })
  );

  assert.match(html, /Example Catch/);
  assert.match(html, /ml-solo-display/);
  assert.match(html, /ml-solo-floor/);
  assert.match(html, /Objetivo 4/);
  assert.match(html, /Puntos/);
  assert.match(html, /48/);
});
