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
});

test("initial frame shows the first target", () => {
  const firstTarget = helloWorldTargets()[0];
  const game = createGame({ seed: manifest.defaultSeed, playerCount: 1 });

  game.init(0);

  assert.equal(frameCell(game.render(), firstTarget.x - 1, firstTarget.y - 1)?.color, targetColor);
  assert.equal(game.snapshot().activeTargets, 1);
});

test("pressing targets completes the hello world path", () => {
  const game = createGame({ seed: manifest.defaultSeed, playerCount: 1 });

  game.init(0);

  helloWorldTargets().forEach((target, index) => {
    const events = game.press({ ...target, pressed: true, atMillis: (index + 1) * 100 });
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
  assert.match(html, /Goal/);
  assert.match(html, /0\/5/);
});
