import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOOR_COLS, FLOOR_ROWS, frameCell, type GameEvent } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  crowdedRunningSnapshot,
  dueloReadyZones,
  finishedFrame,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  startingSnapshot,
  waitingSnapshot,
  winAnimationMillis,
  type DueloGameInstance,
  type DueloSnapshot
} from "../src/index.ts";

test("manifest exposes production Duelo with strict 2–8 player support", () => {
  assert.equal(manifest.id, "duelo");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: false, min: 2, max: 8 });
  assert.deepEqual(manifest.config?.difficulty?.options, ["medium", "hard"]);
  assert.equal(manifest.start.mode, "player-ready");
  assert.equal(manifest.start.countdownMillis, 3_000);
  assert.equal(manifest.start.releaseGraceMillis, 2_000);
});

test("every supported player count has distinct in-bounds readiness zones", () => {
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const zones = dueloReadyZones(playerCount);
    assert.equal(zones.length, playerCount);
    const occupied = new Set<string>();
    for (const zone of zones) {
      assert.ok(zone.minX >= 0 && zone.maxX < FLOOR_COLS);
      assert.ok(zone.minY >= 0 && zone.maxY < FLOOR_ROWS);
      for (let y = zone.minY; y <= zone.maxY; y += 1) {
        for (let x = zone.minX; x <= zone.maxX; x += 1) {
          const key = `${x},${y}`;
          assert.equal(occupied.has(key), false, `${playerCount} players overlap at ${key}`);
          occupied.add(key);
        }
      }
    }
  }
});

test("board targets are exactly fair and difficulty controls density", () => {
  for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
    const medium = createGame({ playerCount, difficulty: "medium", seed: 137 });
    medium.init(0);
    const mediumSnapshot = medium.snapshot();
    assert.equal(new Set(mediumSnapshot.playerProgress.map((player) => player.target)).size, 1);
    assert.ok(mediumSnapshot.totalTargets <= Math.round(512 * 0.6));
    assert.ok(mediumSnapshot.totalTargets > Math.round(512 * 0.6) - playerCount);

    const hard = createGame({ playerCount, difficulty: "hard", seed: 137 });
    hard.init(0);
    const hardSnapshot = hard.snapshot();
    assert.equal(new Set(hardSnapshot.playerProgress.map((player) => player.target)).size, 1);
    assert.ok(hardSnapshot.totalTargets > mediumSnapshot.totalTargets);
    assert.equal(hardSnapshot.fillPercent, 90);
  }
});

test("manifest-owned tuning variables normalize fill values", () => {
  const game = createGame({
    playerCount: 2,
    difficulty: "hard",
    options: {
      base_fill_percent: 20,
      hard_fill_multiplier: 9,
      undeclared: 123
    }
  });
  game.init(0);
  assert.equal(game.snapshot().fillPercent, 54);
});

test("same seed produces the same organic board and another seed changes it", () => {
  const board = (seed: number) => {
    const game = createGame({ playerCount: 5, difficulty: "hard", seed });
    game.init(0);
    return Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, (_, index) => (
      game.targetOwner(index % FLOOR_COLS, Math.floor(index / FLOOR_COLS))
    ));
  };
  assert.deepEqual(board(137), board(137));
  assert.notDeepEqual(board(137), board(138));
});

test("readiness stays live and cancels when a player leaves after grace", () => {
  const game = createGame({ playerCount: 3 });
  game.init(0);
  occupyReadyZones(game, 100);
  assert.equal(game.snapshot().phase, "starting");
  assert.deepEqual(game.snapshot().readyPlayerIndices, [0, 1, 2]);

  const zone = game.playerReadyZones()[1];
  assert.ok(zone);
  game.release({ x: zone.minX, y: zone.minY, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 2_201 });
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().readyPlayers, 2);

  game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 2_300 });
  game.tick({ atMillis: 5_300 });
  assert.equal(game.snapshot().phase, "running");
});

test("neutral, released, duplicate, and out-of-bounds inputs never score", () => {
  const game = createGame({ playerCount: 2, options: { base_fill_percent: 30 }, seed: 12 });
  game.init(0);
  startGame(game);
  const neutral = findTile(game, -1);
  const target = findTile(game, 0);
  assert.ok(neutral && target);
  const scoreBefore = game.snapshot().score;

  assert.deepEqual(game.press({ ...neutral, pressed: true, atMillis: 3_200 }), []);
  assert.deepEqual(game.release({ ...target, pressed: false, atMillis: 3_210 }), []);
  assert.deepEqual(game.press({ x: -1, y: 99, pressed: true, atMillis: 3_220 }), []);
  const first = game.press({ ...target, pressed: true, atMillis: 3_230 });
  assert.equal(first.length, 1);
  assert.deepEqual(game.press({ ...target, pressed: true, atMillis: 3_240 }), []);
  assert.equal(game.snapshot().score, scoreBefore + 1);
});

test("claim feedback stays on the pressed tile for its full animation", () => {
  const config = { playerCount: 2, options: { base_fill_percent: 30 }, seed: 137 };
  const control = createGame(config);
  const claimed = createGame(config);
  control.init(0);
  claimed.init(0);
  startGame(control);
  startGame(claimed);

  const target = findTile(claimed, 0, true);
  assert.ok(target);
  claimed.press({ ...target, pressed: true, atMillis: 3_200 });

  for (const offset of [0, 159, 160, 319, 320, 419, 420, 699, 700]) {
    const atMillis = 3_200 + offset;
    control.tick({ atMillis });
    claimed.tick({ atMillis });
    const controlFrame = control.render();
    const claimedFrame = claimed.render();
    const changedTiles = claimedFrame.cells.flatMap((cell, index) => (
      cell.color === controlFrame.cells[index]?.color ? [] : [`${cell.x},${cell.y}`]
    ));

    assert.deepEqual(changedTiles, [`${target.x},${target.y}`], `unexpected feedback at ${offset}ms`);
  }
});

test("a unique leader appears only after progress breaks the tie", () => {
  const game = createGame({ playerCount: 4, seed: 137 });
  game.init(0);
  startGame(game);
  assert.equal(game.snapshot().leaderIndex, -1);
  const target = findTile(game, 2);
  assert.ok(target);
  game.press({ ...target, pressed: true, atMillis: 3_200 });
  assert.equal(game.snapshot().leaderIndex, 2);
});

test("winner celebration locks scoring and automatically resets after five seconds", () => {
  const game = createGame({ playerCount: 2, seed: 9, options: { base_fill_percent: 30 } });
  game.init(0);
  startGame(game);
  const win = claimAll(game, 0, 4_000);
  assert.equal(win.filter((event) => event.cue === "win").length, 1);
  const finished = game.snapshot();
  assert.equal(finished.phase, "finished");
  assert.equal(finished.winnerIndex, 0);
  assert.equal(finished.success, true);
  assert.doesNotMatch(finished.lastEventMessage, /\.$/);

  const otherTarget = findTile(game, 1);
  assert.ok(otherTarget);
  const score = game.snapshot().score;
  assert.deepEqual(game.press({ ...otherTarget, pressed: true, atMillis: 4_500 }), []);
  assert.equal(game.snapshot().score, score);

  const winAt = finished.elapsedMillis + 3_100;
  game.tick({ atMillis: winAt + winAnimationMillis - 1 });
  assert.equal(game.snapshot().phase, "finished");
  const resetEvents = game.tick({ atMillis: winAt + winAnimationMillis });
  assert.equal(resetEvents[0]?.message, "Nuevo duelo");
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().score, 0);
});

test("fixtures cover every phase and displays keep long names without ellipses", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(startingSnapshot.phase, "starting");
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(finishedSnapshot.phase, "finished");
  assert.equal(crowdedRunningSnapshot.players.length, 8);
  assert.ok(frameCell(runningFrame, 0, 0));
  assert.ok(frameCell(finishedFrame, 0, 0));

  for (const snapshot of [waitingSnapshot, startingSnapshot, runningSnapshot, crowdedRunningSnapshot, finishedSnapshot]) {
    const html = renderDisplay(snapshot);
    assert.match(html, /Duelo/);
    assert.match(html, /baldosas restantes/);
    assert.match(html, /aria-label="[^"]+: [0-9]+ baldosas restantes"/);
    assert.doesNotMatch(html, /…|\.\.\./);
  }
  assert.match(renderDisplay(crowdedRunningSnapshot), /Alejandra del Equipo Relámpago/);
  assert.match(renderDisplay(crowdedRunningSnapshot), /Objetivo/);
  assert.match(renderDisplay(crowdedRunningSnapshot), /Jugadores/);
  assert.match(renderDisplay(finishedSnapshot), /Nueva partida en/);
});

test("Duelo display composes the shared display system", () => {
  const source = readFileSync(new URL("../src/display.tsx", import.meta.url), "utf8");
  assert.match(source, /DisplayStack/);
  assert.match(source, /PlayerRoster/);
  assert.match(source, /ProgressMeter/);
  assert.match(source, /ResultOverlay/);
  assert.doesNotMatch(source, /duelo-display|duelo-player/);
});

function occupyReadyZones(game: DueloGameInstance, atMillis: number): void {
  game.playerReadyZones().forEach((zone) => {
    game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis });
  });
}

function startGame(game: DueloGameInstance): void {
  occupyReadyZones(game, 100);
  game.tick({ atMillis: 3_100 });
  assert.equal(game.snapshot().phase, "running");
}

function findTile(
  game: DueloGameInstance,
  owner: number,
  interior = false
): { x: number; y: number } | undefined {
  const inset = interior ? 1 : 0;
  for (let y = inset; y < FLOOR_ROWS - inset; y += 1) {
    for (let x = inset; x < FLOOR_COLS - inset; x += 1) {
      if (game.targetOwner(x, y) === owner) return { x, y };
    }
  }
  return undefined;
}

function claimAll(game: DueloGameInstance, owner: number, atMillis: number): GameEvent[] {
  const events: GameEvent[] = [];
  let offset = 0;
  for (let y = 0; y < FLOOR_ROWS; y += 1) {
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      if (game.targetOwner(x, y) !== owner) continue;
      events.push(...game.press({ x, y, pressed: true, atMillis: atMillis + offset }));
      offset += 1;
    }
  }
  return events;
}

function renderDisplay(snapshot: DueloSnapshot): string {
  return renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot }));
}
