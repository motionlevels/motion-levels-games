import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_ROWS, createGameEngine, type Frame } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay as HelloWorldDisplay,
  createGame as createHelloWorldGame,
  hazardColor,
  helloWorldHazards,
  helloWorldStartingLives,
  helloWorldTargetScore,
  helloWorldTargets,
  manifest as helloWorldManifest,
  targetColor
} from "@motion-levels-games/hello-world";
import {
  PlayerDisplay as PingPongDisplay,
  createGame as createPingPongGame,
  manifest as pingPongManifest,
  type PingPongSnapshot
} from "@motion-levels-games/ping-pong";

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
  assert.equal(countColor(engine.state.frame, hazardColor), 1, "one red hazard should be visible");

  const [firstHazard] = helloWorldHazards();
  assert.ok(firstHazard);
  engine.press(firstHazard.x, firstHazard.y);
  engine.release(firstHazard.x, firstHazard.y);
  engine.step();
  assert.equal(engine.state.snapshot.lives, helloWorldStartingLives - 1);
  assert.equal(countColor(engine.state.frame, hazardColor), 1, "the next red hazard should replace the pressed one");

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

  assert.ok(html.includes(helloWorldManifest.label));
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

function playtestPingPong() {
  const game = createPingPongGame({
    difficulty: "medium",
    options: { points_to_win: 3 },
    playerCount: 2,
    seed: 137
  });
  const engine = createGameEngine(game, {
    initialEvents: game.init(0)
  });

  let snapshot = engine.state.snapshot as PingPongSnapshot;
  assert.equal(snapshot.currentGame, pingPongManifest.id);
  assert.equal(snapshot.phase, "waiting");
  assert.equal(snapshot.readyPlayers, 0);

  engine.press(7, 3);
  engine.press(7, FLOOR_ROWS - 4);
  snapshot = engine.state.snapshot as PingPongSnapshot;
  assert.equal(snapshot.phase, "starting");
  assert.equal(snapshot.readyPlayers, 2);

  engine.step(2_000);
  snapshot = engine.state.snapshot as PingPongSnapshot;
  assert.equal(snapshot.phase, "running");

  for (let step = 0; step < 600 && snapshot.rounds.length < 2; step += 1) {
    engine.step(100);
    snapshot = engine.state.snapshot as PingPongSnapshot;
  }

  assert.equal(snapshot.phase, "running", "the match should continue after two of three points");
  assert.equal(snapshot.rounds.length, 2, "the CI playtest should complete two rounds");
  assert.equal(snapshot.score, 2);
  assert.equal(snapshot.players.reduce((score, player) => score + player.score, 0), 2);
  assert.ok(snapshot.rounds.every((round) => round.winnerIndex === 0 || round.winnerIndex === 1));

  const html = renderToStaticMarkup(
    React.createElement(PingPongDisplay, {
      snapshot,
      frame: engine.state.frame
    })
  );

  assert.ok(html.includes(pingPongManifest.label));
  assert.match(html, /2 de 5 rondas jugadas/);

  return {
    clockMillis: engine.clockMillis,
    fps: engine.fps,
    phase: snapshot.phase,
    rounds: snapshot.rounds.length,
    score: snapshot.players.map((player) => player.score)
  };
}

const result = {
  helloWorld: playtestHelloWorld(),
  pingPong: playtestPingPong()
};

console.log(JSON.stringify(result, null, 2));
