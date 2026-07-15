import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gamePlayerCountOptions } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  estelaStartPositions,
  finishedFrame,
  finishedSnapshot,
  manifest,
  roundWinAnimationMillis,
  roundWinSnapshot,
  roundsToWin,
  runningFrame,
  runningSnapshot,
  type EstelaGameInstance
} from "../src/index.ts";

test("manifest requires an exact two-to-eight player roster", () => {
  assert.deepEqual(gamePlayerCountOptions(manifest), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(manifest.players.allowAny, false);
  assert.equal(manifest.availability.production, true);
});

test("every supported roster gets distinct start positions and must be ready", () => {
  for (const count of gamePlayerCountOptions(manifest)) {
    const positions = estelaStartPositions(count);
    assert.equal(new Set(positions.map(({ x, y }) => `${x},${y}`)).size, count);
    const game = createGame({ playerCount: count });
    game.init(0);
    positions.slice(0, -1).forEach((position) => game.press({ ...position, pressed: true, atMillis: 100 }));
    assert.equal(game.snapshot().phase, "waiting");
    game.press({ ...positions.at(-1)!, pressed: true, atMillis: 100 });
    assert.equal(game.snapshot().phase, "starting");
    assert.equal(game.snapshot().readyPlayers, count);
  }
});

test("leaving a platform cancels the countdown after grace", () => {
  const game = createGame({ playerCount: 2 });
  game.init(0);
  game.press({ x: 2, y: 2, pressed: true, atMillis: 100 });
  game.press({ x: 13, y: 29, pressed: true, atMillis: 100 });
  game.release({ x: 2, y: 2, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 2_201 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("movement paints a permanent trail and collisions eliminate the nearest player", () => {
  const game = createStartedGame();
  const before = game.snapshot().trailCells.length;
  game.press({ x: 3, y: 2, pressed: true, atMillis: 3_200 });
  assert.equal(game.snapshot().trailCells.length, before + 1);
  game.press({ x: 2, y: 2, pressed: true, atMillis: 3_201 });
  assert.equal(game.snapshot().phase, "round-win");
  assert.equal(game.snapshot().roundWinnerIndex, 1);
  assert.equal(game.snapshot().playerProgress[0]?.alive, false);
});

test("the arena contracts by difficulty and removes players beyond its border", () => {
  const easy = createStartedGame("easy");
  const hard = createStartedGame("hard");
  easy.tick({ atMillis: 12_200 });
  hard.tick({ atMillis: 12_200 });
  assert.equal(easy.snapshot().arenaInset, 0);
  assert.ok(hard.snapshot().arenaInset > easy.snapshot().arenaInset);
  hard.press({ x: 0, y: 2, pressed: true, atMillis: 12_201 });
  assert.equal(hard.snapshot().phase, "round-win");
});

test("round wins lock input and two wins become a distinct game win", () => {
  const game = createStartedGame();
  eliminateFirst(game, 3_200);
  const trailCount = game.snapshot().trailCells.length;
  game.press({ x: 8, y: 8, pressed: true, atMillis: 3_300 });
  assert.equal(game.snapshot().trailCells.length, trailCount);
  game.tick({ atMillis: 3_201 + roundWinAnimationMillis });
  assert.equal(game.snapshot().phase, "running");
  eliminateFirst(game, 5_200);
  assert.equal(game.snapshot().playerProgress[1]?.roundWins, roundsToWin);
  game.tick({ atMillis: 5_201 + roundWinAnimationMillis });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().gameWinnerIndex, 1);
  assert.equal(game.snapshot().success, true);
  const frame = game.render();
  game.tick({ atMillis: 8_000 });
  assert.notDeepEqual(game.render(), frame);
});

test("fixtures and Spanish multiplayer display cover running and both wins", () => {
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(roundWinSnapshot.phase, "round-win");
  assert.equal(finishedSnapshot.phase, "finished");
  assert.equal(finishedFrame.width, 16);
  const runningHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  const roundHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: roundWinSnapshot }));
  const finishedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: finishedSnapshot, frame: finishedFrame }));
  assert.match(runningHtml, /¡No cruces las estelas!/);
  assert.match(runningHtml, /Jugador 1/);
  assert.doesNotMatch(runningHtml, /Player 1/);
  assert.match(runningHtml, /Longitud de estela/);
  assert.match(roundHtml, /La siguiente ronda empieza en breve/);
  assert.match(finishedHtml, /rondas ganadas/);
  assert.doesNotMatch(finishedHtml, /Score|Round winner|Game winner/);
});

function createStartedGame(difficulty = "medium"): EstelaGameInstance {
  const game = createGame({ playerCount: 2, difficulty });
  game.init(0);
  game.press({ x: 2, y: 2, pressed: true, atMillis: 100 });
  game.press({ x: 13, y: 29, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 3_100 });
  assert.equal(game.snapshot().phase, "running");
  return game;
}
function eliminateFirst(game: EstelaGameInstance, atMillis: number): void {
  game.press({ x: 3, y: 2, pressed: true, atMillis });
  game.press({ x: 2, y: 2, pressed: true, atMillis: atMillis + 1 });
}
