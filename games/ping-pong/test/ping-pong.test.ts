import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_COLS, FLOOR_ROWS, frameCell, type Frame } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  ballColor,
  createGame,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  waitingSnapshot
} from "../src/index.ts";

function countColor(frame: Frame, color: string): number {
  return frame.cells.filter((cell) => cell.color === color).length;
}

function assertClose(actual: number, expected: number, tolerance = 0.0001): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
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
  assert.deepEqual(
    manifest.config?.vars?.map((variable) => variable.key),
    ["points_to_win", "initial_ball_speed", "return_speed_multiplier", "difficulty_multiplier"]
  );
  assert.deepEqual(
    manifest.config?.vars?.map((variable) => variable.label),
    [
      "Points to win",
      "Initial ball speed (tiles/s)",
      "Speed multiplier per return",
      "Difficulty multiplier step"
    ]
  );
  assert.ok(manifest.config?.vars?.every((variable) => Boolean(variable.description)));
});

test("difficulty applies one configurable multiplicative speed curve", () => {
  const options = {
    initial_ball_speed: 5.75,
    return_speed_multiplier: 1.035,
    difficulty_multiplier: 1.2
  };
  const expected = [
    ["easy", 1],
    ["medium", 1.2],
    ["hard", 1.44],
    ["expert", 1.728]
  ] as const;

  for (const [difficulty, factor] of expected) {
    const game = createGame({ seed: 7, playerCount: 2, difficulty, options });
    game.init(0);
    const snapshot = game.snapshot();

    assertClose(snapshot.difficultySpeedFactor, factor);
    assertClose(snapshot.initialBallSpeed, options.initial_ball_speed * factor);
    assertClose(
      snapshot.returnSpeedMultiplier,
      1 + (options.return_speed_multiplier - 1) * factor
    );
    assertClose(snapshot.ballSpeed, snapshot.initialBallSpeed);
  }
});

test("custom speed and difficulty variables tune the same shared model", () => {
  const game = createGame({
    seed: 7,
    playerCount: 2,
    difficulty: "medium",
    options: {
      initial_ball_speed: 8,
      return_speed_multiplier: 1.04,
      difficulty_multiplier: 1.25
    }
  });
  game.init(0);
  const snapshot = game.snapshot();

  assertClose(snapshot.difficultySpeedFactor, 1.25);
  assertClose(snapshot.initialBallSpeed, 10);
  assertClose(snapshot.returnSpeedMultiplier, 1.05);
  assertClose(snapshot.ballSpeed, 10);
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
  assert.ok(snapshot.ball.x >= 0 && snapshot.ball.x < FLOOR_COLS);
  assert.ok(snapshot.ball.y >= 0 && snapshot.ball.y < FLOOR_ROWS);
  assert.equal(snapshot.rallyPace, 0);
});

test("running animation exposes deterministic trail, pace, and impact state", () => {
  const game = createGame({
    seed: 7,
    playerCount: 2,
    difficulty: "hard",
    options: { points_to_win: 5 }
  });
  game.init(0);
  game.press({ x: 7, y: 4, pressed: true, atMillis: 100 });
  game.press({ x: 7, y: FLOOR_ROWS - 5, pressed: true, atMillis: 200 });
  game.tick({ atMillis: 2300 });
  const initialSpeed = game.snapshot().initialBallSpeed;

  let impactSeen = false;
  for (let atMillis = 2340; atMillis <= 12_000; atMillis += 40) {
    const before = game.snapshot();
    const paddleY = before.ball.dy < 0 ? 2 : FLOOR_ROWS - 3;
    game.press({ x: before.ball.x, y: paddleY, pressed: true, atMillis: atMillis - 1 });
    const events = game.tick({ atMillis });
    if (events.some((event) => event.cue === "coin")) {
      impactSeen = true;
      const impactSnapshot = game.snapshot();
      assert.ok(impactSnapshot.impact);
      assert.ok(impactSnapshot.motionEventId > 1);
      assertClose(
        impactSnapshot.ballSpeed,
        initialSpeed * impactSnapshot.returnSpeedMultiplier
      );
      break;
    }
  }

  const snapshot = game.snapshot();
  assert.equal(impactSeen, true, "a tracked paddle should produce an impact animation");
  assert.ok(snapshot.ballTrail.length > 0 && snapshot.ballTrail.length <= 5);
  assert.ok(snapshot.rallyPace > 0 && snapshot.rallyPace <= 1);
  assert.equal(countColor(game.render(), ballColor), 1);
});

test("floor animation evolves between engine frames without changing dimensions", () => {
  const game = startGame();
  game.press({ x: 7, y: 4, pressed: true, atMillis: 100 });
  game.press({ x: 7, y: FLOOR_ROWS - 5, pressed: true, atMillis: 200 });
  game.tick({ atMillis: 2300 });
  const first = game.render().cells.map((cell) => cell.color);

  game.tick({ atMillis: 2333 });
  const secondFrame = game.render();
  const second = secondFrame.cells.map((cell) => cell.color);

  assert.equal(secondFrame.width, FLOOR_COLS);
  assert.equal(secondFrame.height, FLOOR_ROWS);
  assert.notDeepEqual(second, first);
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
  assert.match(waitingHtml, /Listos/);
  assert.match(waitingHtml, /0\/2/);
  assert.match(waitingHtml, /Siguiente/);
  assert.match(waitingHtml, /Por comenzar/);
  assert.match(waitingHtml, /ml-metric-neutral[^>]*>[\s\S]*?Último/);

  const html = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: runningSnapshot,
      frame: runningFrame
    })
  );

  assert.match(html, /Ping Pong/);
  assert.match(html, /Peloteo/);
  assert.match(html, /Ronda/);
  assert.match(html, /1\/9/);
  assert.match(html, /En juego/);
  assert.match(html, /Punto en curso/);
  assert.match(html, /ping-pong-rally-lane/);
  assert.match(html, /Trayectoria de la pelota/);
  assert.match(html, /ping-pong-ball-trail/);
  assert.match(html, /3 golpes/);
  assert.match(html, /--ping-pong-rally-pace:0.1935/);
  assert.doesNotMatch(html, /Listos/);
  assert.doesNotMatch(html, /2\/2/);

  const blueWinnerHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: finishedSnapshot,
      frame: runningFrame
    })
  );
  assert.match(blueWinnerHtml, /ml-metric-blue[^>]*>[\s\S]*?Último/);
  assert.match(blueWinnerHtml, /is-winner-blue/);
  assert.match(blueWinnerHtml, /Victoria Azul/);

  const redWinnerHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: { ...finishedSnapshot, lastRoundWinner: "Rojo" },
      frame: runningFrame
    })
  );
  assert.match(redWinnerHtml, /ml-metric-red[^>]*>[\s\S]*?Último/);
});
