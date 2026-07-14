import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import { PlayerDisplay, createGame, manifest, runningFrame, runningSnapshot } from "../src/index.ts";
import type { TetrisGameInstance, TetrisSnapshot } from "../src/game.ts";

const boardX = 3;

function startedGame(options: Record<string, number> = {}) {
  const game = createGame({ playerCount: 1, seed: 137, options });
  game.init(0);
  game.press({ x: 8, y: 29, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_200 });
  return game;
}

test("manifest exposes a production, player-ready Tetris game", () => {
  assert.equal(manifest.id, "tetris");
  assert.equal(manifest.availability.production, true);
  assert.equal(manifest.start.mode, "player-ready");
  assert.equal(manifest.players.allowAny, true);
  assert.deepEqual(manifest.config?.difficulty?.options, ["easy", "medium", "hard"]);
  assert.equal(manifest.config?.vars?.[0]?.key, "lines_to_win");
});

test("the physical ready zone starts play and a floor drop locks a piece", () => {
  const game = createGame({ playerCount: 4, seed: 137 });
  game.init(0);
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: 8, y: 29, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 2_200 });
  assert.equal(game.snapshot().phase, "running");

  const firstShape = game.snapshot().activePiece.shape;
  game.press({ x: 5, y: 31, pressed: true, atMillis: 2_300 });
  const snapshot = game.snapshot();
  assert.notEqual(snapshot.activePiece.shape, firstShape);
  assert.equal(snapshot.board.flat().filter(Boolean).length, 4);
  assert.equal(snapshot.players.length, 1);
  assert.equal(frameCell(game.render(), 4, 31)?.color !== "#020609", true);
});

test("diagonal controls rotate with cooldown and guide presses steer", () => {
  const game = startedGame();
  const initial = game.snapshot();
  game.press({ x: initial.guideX + 1, y: initial.guideY - 1, pressed: true, atMillis: 2_300 });
  assert.equal(game.snapshot().activePiece.rotation, 1);
  game.press({ x: initial.guideX + 1, y: initial.guideY - 1, pressed: true, atMillis: 2_350 });
  assert.equal(game.snapshot().activePiece.rotation, 1);
  game.press({ x: 12, y: 20, pressed: true, atMillis: 2_500 });
  assert.equal(game.snapshot().guideX, 11);
  assert.equal(game.snapshot().guideY, 20);
  assert.equal(game.snapshot().activePiece.x >= 9, true);
});

test("clearing the configured line target wins, celebrates, and resets", () => {
  const game = startedGame({ lines_to_win: 1 });
  const finished = autoplay(game, 2_300, 100);
  assert.equal(finished.phase, "finished");
  assert.equal(finished.result, "game-win");
  assert.equal(finished.success, true);
  assert.equal(finished.lines >= 1, true);
  assert.equal(finished.score >= 100, true);
  assert.equal(finished.lastEventMessage, "¡Objetivo de 1 línea completado!");

  const locked = finished.board.flat().filter(Boolean).length;
  game.press({ x: 8, y: 31, pressed: true, atMillis: finished.elapsedMillis + 2_400 });
  assert.equal(game.snapshot().board.flat().filter(Boolean).length, locked);
  game.tick({ atMillis: finished.elapsedMillis + 6_300 });
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().score, 0);
});

test("stacking without clearing eventually loses at the top", () => {
  const game = startedGame({ lines_to_win: 40 });
  let now = 2_300;
  for (let index = 0; index < 80 && game.snapshot().phase === "running"; index += 1) {
    game.press({ x: 5, y: 31, pressed: true, atMillis: now });
    now += 200;
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().result, "game-loss");
  assert.equal(game.snapshot().success, false);
  assert.equal(game.snapshot().lastEventMessage, "Las piezas llegaron arriba");
});

test("fixtures and the Spanish venue display render", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  assert.equal(runningSnapshot.phase, "running");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  assert.match(html, /Tetris/);
  assert.match(html, /Puntos/);
  assert.match(html, /Líneas/);
  assert.match(html, /Pista de Tetris/);
  assert.match(html, /Baja al fondo para soltar/);
});

function autoplay(game: TetrisGameInstance, startMillis: number, maxPieces: number): TetrisSnapshot {
  let now = startMillis;
  for (let piece = 0; piece < maxPieces && game.snapshot().phase === "running"; piece += 1) {
    const candidates: Placement[] = [];
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const snapshot = game.snapshot();
      candidates.push(...placements(snapshot, rotation));
      now += 200;
      game.press({ x: snapshot.guideX + 1, y: snapshot.guideY - 1, pressed: true, atMillis: now });
    }
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    assert.ok(best, "autoplayer found a legal placement");
    for (let turn = 0; turn < best.rotation; turn += 1) {
      const snapshot = game.snapshot();
      now += 200;
      game.press({ x: snapshot.guideX + 1, y: snapshot.guideY - 1, pressed: true, atMillis: now });
    }
    const width = Math.max(...game.snapshot().activePiece.cells.map(([x]) => x)) + 1;
    now += 200;
    game.press({ x: boardX + best.x + Math.floor(width / 2), y: 31, pressed: true, atMillis: now });
  }
  return game.snapshot();
}

type Placement = { rotation: number; x: number; score: number };
function placements(snapshot: TetrisSnapshot, rotation: number): Placement[] {
  const cells = snapshot.activePiece.cells;
  const width = Math.max(...cells.map(([x]) => x)) + 1;
  const results: Placement[] = [];
  for (let x = 0; x <= 10 - width; x += 1) {
    let y = 0;
    if (collides(snapshot.board, cells, x, y)) continue;
    while (!collides(snapshot.board, cells, x, y + 1)) y += 1;
    const board = snapshot.board.map((row) => [...row]);
    for (const [dx, dy] of cells) board[y + dy]![x + dx] = snapshot.activePiece.color;
    const cleared = board.filter((row) => row.every(Boolean)).length;
    const remaining = board.filter((row) => !row.every(Boolean));
    while (remaining.length < board.length) remaining.unshift(Array(10).fill(null));
    const heights: number[] = [];
    let holes = 0;
    for (let column = 0; column < 10; column += 1) {
      const first = remaining.findIndex((row) => row[column] !== null);
      heights[column] = first < 0 ? 0 : remaining.length - first;
      if (first >= 0) for (let row = first + 1; row < remaining.length; row += 1) if (remaining[row]![column] === null) holes += 1;
    }
    const bumpiness = heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - heights[index]!), 0);
    const aggregate = heights.reduce((sum, height) => sum + height, 0);
    results.push({ rotation, x, score: cleared * 10_000 - holes * 600 - aggregate * 6 - bumpiness * 10 - Math.max(...heights) * 15 });
  }
  return results;
}

function collides(board: TetrisSnapshot["board"], cells: readonly (readonly [number, number])[], x: number, y: number): boolean {
  return cells.some(([dx, dy]) => y + dy >= board.length || x + dx < 0 || x + dx >= 10 || (y + dy >= 0 && board[y + dy]?.[x + dx] !== null));
}
