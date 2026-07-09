import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGameEngine, type Frame } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay as HelloWorldDisplay,
  createGame as createHelloWorldGame,
  helloWorldTargetScore,
  helloWorldTargets,
  manifest as helloWorldManifest,
  targetColor
} from "@motion-levels-games/hello-world";

function countColor(frame: Frame, color: string): number {
  return frame.cells.filter((cell) => cell.color === color).length;
}

function playtestHelloWorld() {
  const game = createHelloWorldGame({
    playerCount: 1,
    durationMillis: helloWorldManifest.defaultDurationMillis
  });
  const engine = createGameEngine(game, {
    initialEvents: game.init(0)
  });

  assert.equal(engine.fps, 30);
  assert.equal(engine.state.snapshot.currentGame, helloWorldManifest.id);
  assert.equal(engine.state.snapshot.phase, "waiting");
  assert.equal(engine.state.snapshot.readyPlayers, 0);

  engine.press(8, 16);
  engine.step(2_000);
  engine.release(8, 16);

  assert.equal(engine.state.snapshot.phase, "running");
  assert.ok(countColor(engine.state.frame, targetColor) > 0, "target should be visible");

  helloWorldTargets().forEach((target, index) => {
    engine.press(target.x, target.y);
    engine.release(target.x, target.y);
    engine.step();
    assert.equal(engine.state.snapshot.score, index + 1);
  });

  assert.equal(engine.state.snapshot.score, helloWorldTargetScore);
  assert.equal(engine.state.snapshot.phase, "finished");
  assert.equal(engine.state.snapshot.success, true);

  const html = renderToStaticMarkup(
    React.createElement(HelloWorldDisplay, {
      snapshot: engine.state.snapshot,
      frame: engine.state.frame
    })
  );

  assert.match(html, /Hello World/);
  assert.match(html, /5\/5/);

  return {
    captures: {
      frame: `${engine.state.frame.width}x${engine.state.frame.height}`,
      displayHtmlLength: html.length
    },
    clockMillis: engine.clockMillis,
    fps: engine.fps,
    score: engine.state.snapshot.score
  };
}

const result = {
  helloWorld: playtestHelloWorld()
};

console.log(JSON.stringify(result, null, 2));
