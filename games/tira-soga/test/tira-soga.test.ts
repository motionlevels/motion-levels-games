import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_COLS, FLOOR_ROWS, frameCell } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  blueFieldColor,
  centerLineColor,
  createGame,
  finishedFrame,
  finishedSnapshot,
  gameWinAnimationMillis,
  manifest,
  onBlueTilePressed,
  onRedTilePressed,
  redFieldColor,
  ropeLimit,
  roundWinAnimationMillis,
  roundWinFrame,
  roundWinSnapshot,
  runningFrame,
  runningSnapshot,
  startingSnapshot,
  teamForTile,
  totalRounds,
  type TiraSogaGameInstance,
  waitingSnapshot
} from "../src/index.ts";

test("manifest defines a five-round two-team game with readiness and three difficulties", () => {
  assert.equal(manifest.id, "tira-soga");
  assert.equal(manifest.label, "Tira-Soga");
  assert.deepEqual(manifest.players, { allowAny: true, min: 2, max: 2 });
  assert.equal(manifest.start.mode, "player-ready");
  assert.deepEqual(manifest.config?.difficulty, {
    default: "medium",
    options: ["easy", "medium", "hard"]
  });
  assert.equal(manifest.defaultDurationMillis, 0);
});

test("both teams must remain on their fields through the countdown", () => {
  const game = createGame({ playerCount: 2 });
  game.init(0);
  assert.equal(game.snapshot().phase, "waiting");

  const [redZone, blueZone] = game.playerReadyZones();
  assert.ok(redZone);
  assert.ok(blueZone);
  game.press({ x: redZone.minX, y: redZone.minY, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: blueZone.minX, y: blueZone.minY, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "starting");
  assert.equal(game.snapshot().readyPlayers, 2);

  game.release({ x: blueZone.minX, y: blueZone.minY, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 2_201 });
  assert.equal(game.snapshot().phase, "waiting");

  game.press({ x: blueZone.minX, y: blueZone.minY, pressed: true, atMillis: 2_300 });
  game.tick({ atMillis: 5_300 });
  assert.equal(game.snapshot().phase, "running");
});

test("Any mode keeps the same two-team floor, readiness, and rules", () => {
  const anyGame = createGame({ playerCount: 0, difficulty: "hard" });
  const twoPlayerGame = createGame({ playerCount: 2, difficulty: "hard" });
  anyGame.init(0);
  twoPlayerGame.init(0);
  startGame(anyGame);
  startGame(twoPlayerGame);

  assert.deepEqual(anyGame.render(), twoPlayerGame.render());
  assert.equal(anyGame.snapshot().requiredPlayers, 2);
  assert.equal(anyGame.snapshot().pressesPerAdvance, 3);
});

test("the floor matches the red, neutral, and blue halves of the 16x32 reference", () => {
  const game = createGame({ playerCount: 2 });
  game.init(0);
  startGame(game);
  const frame = game.render();

  assert.equal(frame.width, FLOOR_COLS);
  assert.equal(frame.height, FLOOR_ROWS);
  assert.equal(frameCell(frame, 0, 0)?.color, redFieldColor);
  assert.equal(frameCell(frame, 0, 15)?.color, centerLineColor);
  assert.equal(frameCell(frame, 0, 16)?.color, centerLineColor);
  assert.equal(frameCell(frame, 0, 31)?.color, blueFieldColor);
  assert.equal(teamForTile(4, 8), 0);
  assert.equal(teamForTile(4, 15), -1);
  assert.equal(teamForTile(11, 24), 1);
  assert.equal(teamForTile(1.5, 8), -1);
});

test("waiting and starting floors animate without changing their dimensions", () => {
  const game = createGame({ playerCount: 2 });
  game.init(0);
  const waitingFrame = game.render();
  game.tick({ atMillis: 200 });
  assert.notDeepEqual(game.render().cells, waitingFrame.cells);

  const [redZone, blueZone] = game.playerReadyZones();
  assert.ok(redZone);
  assert.ok(blueZone);
  game.press({ x: redZone.minX, y: redZone.minY, pressed: true, atMillis: 300 });
  game.press({ x: blueZone.minX, y: blueZone.minY, pressed: true, atMillis: 300 });
  const startingFrame = game.render();
  game.tick({ atMillis: 500 });
  assert.notDeepEqual(game.render().cells, startingFrame.cells);
  assert.equal(game.render().width, FLOOR_COLS);
  assert.equal(game.render().height, FLOOR_ROWS);
});

test("difficulty requires one, two, or three presses for each rope advance", () => {
  for (const [difficulty, threshold] of [["easy", 1], ["medium", 2], ["hard", 3]] as const) {
    const game = createGame({ playerCount: 2, difficulty });
    game.init(0);
    startGame(game);

    for (let press = 1; press < threshold; press += 1) {
      onRedTilePressed(game, 3_200 + press * 10);
      assert.equal(game.snapshot().ropePosition, 0);
      assert.equal(game.snapshot().redProgress, press);
    }

    onRedTilePressed(game, 3_200 + threshold * 10);
    assert.equal(game.snapshot().ropePosition, -1);
    assert.equal(game.snapshot().redProgress, 0);
    assert.equal(game.snapshot().pressesPerAdvance, threshold);
  }
});

test("held tiles and neutral center tiles cannot score repeatedly", () => {
  const game = createGame({ playerCount: 2, difficulty: "easy" });
  game.init(0);
  startGame(game);

  game.press({ x: 4, y: 8, pressed: true, atMillis: 3_200 });
  game.press({ x: 4, y: 8, pressed: true, atMillis: 3_210 });
  game.press({ x: 4, y: 15, pressed: true, atMillis: 3_220 });
  assert.equal(game.snapshot().redPresses, 1);
  assert.equal(game.snapshot().ropePosition, -1);

  game.release({ x: 4, y: 8, pressed: false, atMillis: 3_230 });
  game.press({ x: 4, y: 8, pressed: true, atMillis: 3_240 });
  assert.equal(game.snapshot().redPresses, 2);
  assert.equal(game.snapshot().ropePosition, -2);
});

test("a round win is animated, blocks scoring, and then resets the rope", () => {
  const game = createGame({ playerCount: 2, difficulty: "easy" });
  game.init(0);
  startGame(game);
  let atMillis = 3_200;
  for (let index = 0; index < ropeLimit; index += 1) {
    onBlueTilePressed(game, atMillis);
    atMillis += 10;
  }

  const wonAt = atMillis - 10;
  const firstFrame = game.render();
  assert.equal(game.snapshot().roundWinnerIndex, 1);
  assert.equal(game.snapshot().players[1]?.score, 1);
  assert.equal(game.snapshot().rounds.length, 1);
  onRedTilePressed(game, wonAt + 20);
  assert.equal(game.snapshot().ropePosition, ropeLimit);

  game.tick({ atMillis: wonAt + 400 });
  assert.notDeepEqual(game.render().cells, firstFrame.cells);
  game.tick({ atMillis: wonAt + roundWinAnimationMillis + 1 });
  assert.equal(game.snapshot().roundWinnerIndex, -1);
  assert.equal(game.snapshot().ropePosition, 0);
  assert.equal(game.snapshot().currentRound, 2);
  assert.equal(game.snapshot().redPresses, 0);
  assert.equal(game.snapshot().bluePresses, 0);
});

test("the game plays all five rounds, celebrates the winner, and resets", () => {
  const game = createGame({ playerCount: 2, difficulty: "easy" });
  game.init(0);
  startGame(game);
  let atMillis = 3_200;

  for (const winner of [0, 1, 0, 1, 0] as const) {
    atMillis = winRound(game, winner, atMillis);
  }

  const snapshot = game.snapshot();
  const firstWinFrame = game.render();
  assert.equal(snapshot.phase, "finished");
  assert.equal(snapshot.success, true);
  assert.equal(snapshot.rounds.length, totalRounds);
  assert.equal(snapshot.players[0]?.score, 3);
  assert.equal(snapshot.players[1]?.score, 2);
  assert.equal(snapshot.winnerIndex, 0);
  assert.equal(snapshot.lastEventMessage, "Rojo gana Tira-Soga");

  onBlueTilePressed(game, atMillis + 20);
  assert.deepEqual(game.snapshot().players.map((player) => player.score), [3, 2]);
  assert.equal(game.snapshot().ropePosition, -ropeLimit);

  game.tick({ atMillis: atMillis + 500 });
  assert.notDeepEqual(game.render().cells, firstWinFrame.cells);
  game.tick({ atMillis: atMillis + gameWinAnimationMillis });
  assert.equal(game.snapshot().phase, "waiting");
  assert.deepEqual(game.snapshot().players.map((player) => player.score), [0, 0]);
});

test("fixtures and player display cover every phase and both celebrations", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(startingSnapshot.phase, "starting");
  assert.equal(runningSnapshot.phase, "running");
  assert.ok(runningSnapshot.ropePosition > 0);
  assert.equal(runningFrame.width, FLOOR_COLS);
  assert.equal(roundWinSnapshot.roundWinnerIndex, 0);
  assert.equal(roundWinFrame.width, FLOOR_COLS);
  assert.equal(finishedSnapshot.phase, "finished");
  assert.equal(finishedSnapshot.winnerIndex, 0);
  assert.equal(finishedFrame.height, FLOOR_ROWS);

  const waitingHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, { snapshot: waitingSnapshot })
  );
  assert.match(waitingHtml, /Esperando jugadores/);
  assert.match(waitingHtml, /0\/2/);

  const runningHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame })
  );
  assert.match(runningHtml, /Tira-Soga/);
  assert.match(runningHtml, /Pisadas rojas/);
  assert.match(runningHtml, /Pisadas azules/);
  assert.match(runningHtml, /Posición de la soga/);

  const roundHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, { snapshot: roundWinSnapshot })
  );
  assert.match(roundHtml, /Ronda para Rojo/);
  assert.match(roundHtml, /is-round-win/);

  const finishedHtml = renderToStaticMarkup(
    React.createElement(PlayerDisplay, { snapshot: finishedSnapshot })
  );
  assert.match(finishedHtml, /¡Gana Rojo!/);
  assert.match(finishedHtml, /Resultado final 3 – 2/);
  assert.match(finishedHtml, /is-game-win/);
  assert.match(readFileSync(new URL("../src/display.css", import.meta.url), "utf8"), /prefers-reduced-motion: reduce/);
  assert.match(finishedHtml, /R5/);
});

function startGame(game: TiraSogaGameInstance): void {
  const [redZone, blueZone] = game.playerReadyZones();
  if (!redZone || !blueZone) {
    throw new Error("Tira-Soga requires two ready zones");
  }
  game.press({ x: redZone.minX + 1, y: redZone.minY + 1, pressed: true, atMillis: 100 });
  game.press({ x: blueZone.minX + 1, y: blueZone.minY + 1, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 3_100 });
  game.release({ x: redZone.minX + 1, y: redZone.minY + 1, pressed: false, atMillis: 3_101 });
  game.release({ x: blueZone.minX + 1, y: blueZone.minY + 1, pressed: false, atMillis: 3_101 });
  assert.equal(game.snapshot().phase, "running");
}

function winRound(game: TiraSogaGameInstance, team: 0 | 1, startAt: number): number {
  let atMillis = startAt;
  for (let index = 0; index < ropeLimit; index += 1) {
    if (team === 0) {
      onRedTilePressed(game, atMillis);
    } else {
      onBlueTilePressed(game, atMillis);
    }
    atMillis += 10;
  }
  if (game.snapshot().phase !== "finished") {
    atMillis += roundWinAnimationMillis;
    game.tick({ atMillis });
  }
  return atMillis + 10;
}
