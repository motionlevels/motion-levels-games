import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  finishedSnapshot,
  helloWorldTargetScore,
  helloWorldTargets,
  manifest,
  runningFrame,
  runningSnapshot,
  targetColor
} from "../src/index.ts";

test("manifest documents the example game", () => {
  assert.equal(manifest.id, "hello-world");
  assert.equal(manifest.label, "Hello World");
  assert.deepEqual(manifest.players, { min: 1, max: 1 });
  assert.deepEqual(manifest.start, { mode: "player-ready" });
});

test("game waits for a player and counts down before showing the first target", () => {
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
  assert.equal(game.snapshot().activeTargets, 1);
});

test("pressing targets completes the hello world path", () => {
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
});

test("fixtures and display render the example state", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  assert.equal(finishedSnapshot.success, true);

  const html = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: runningSnapshot,
      frame: runningFrame
    })
  );

  assert.match(html, /Hello World/);
  assert.match(html, /ml-solo-display/);
  assert.match(html, /ml-solo-message/);
  assert.match(html, /Pisa la baldosa verde/);
  assert.match(html, /Meta/);
  assert.match(html, /0\/5/);
});

function startGame(game: ReturnType<typeof createGame>): void {
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
}
