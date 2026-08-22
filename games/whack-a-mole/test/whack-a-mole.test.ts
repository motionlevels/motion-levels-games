import assert from "node:assert/strict";
import test from "node:test";
import {
  createGameEngine,
  gameAudioForEvent,
  type Frame,
  type GamePlaytestAction,
  type PlayerReadyZone
} from "@motion-levels-games/game-sdk";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlayerDisplay,
  createGame,
  finishedSnapshot,
  manifest,
  playtestScenarios,
  readyZonesForPlayers,
  runningSnapshot
} from "../src/index.ts";

function start(playerCount = 4, durationMillis = 60_000) {
  const game = createGame({ playerCount, seed: 404, durationMillis });
  game.init(0);
  game.playerReadyZones().forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  game.tick({ atMillis: 3_200 });
  return game;
}

test("manifest describes the strict one-to-eight player reaction game", () => {
  assert.equal(manifest.id, "whack-a-mole");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: false, min: 1, max: 8 });
});

test("audio reuses one recognizable hit with subtle pitch variation", () => {
  const refs = manifest.audio?.effects?.["mole-hit"]?.map((clip) => clip.ref);
  const rates = manifest.audio?.effects?.["mole-hit"]?.map((clip) => clip.playbackRate);
  assert.deepEqual(new Set(refs).size, 1);
  assert.deepEqual(rates, [0.97, 0.99, 1.01, 1.03]);
  const win = gameAudioForEvent(manifest.audio, "win", 1, { winnerIndex: 2 });
  assert.match(win.narration?.ref ?? "", /victory-player-3\.mp3$/);
  assert.ok((manifest.audio?.narration?.intro?.durationMillis ?? 0) > 20_000);
});

test("every supported roster gets distinct readiness platforms", () => {
  for (let count = 1; count <= 8; count += 1) {
    const zones = readyZonesForPlayers(count);
    assert.equal(zones.length, count);
    assert.equal(new Set(zones.map((zone) => `${zone.minX},${zone.minY}`)).size, count);
  }
});

test("first targets stay clear of every readiness platform", () => {
  for (let count = 1; count <= 8; count += 1) {
    const game = start(count);
    const zones = game.playerReadyZones();
    for (const target of game.snapshot().targets) {
      assert.equal(zones.some((zone) => (
        target.x + 1 >= zone.minX - 1
        && target.x <= zone.maxX + 1
        && target.y + 1 >= zone.minY - 1
        && target.y <= zone.maxY + 1
      )), false, `${count} players target ${target.playerIndex}`);
    }
  }
});

test("all configured players must be ready before targets spawn", () => {
  const game = createGame({ playerCount: 8 });
  game.init(0);
  game.playerReadyZones().slice(0, 7).forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  assert.equal(game.snapshot().phase, "waiting");
  const last = game.playerReadyZones()[7]!;
  game.press({ x: last.minX, y: last.minY, pressed: true, atMillis: 200 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 3_300 });
  assert.equal(game.snapshot().targets.length, 8);
});

test("waiting platforms pulse homogeneously and become calmer when occupied", () => {
  const game = createGame({ playerCount: 2, seed: 404 });
  game.init(0);
  game.tick({ atMillis: 400 });
  const zone = game.playerReadyZones()[0]!;
  const unoccupied = zoneColors(game.render(), zone);
  assert.equal(new Set(unoccupied).size, 1);

  game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 400 });
  const occupied = zoneColors(game.render(), zone);
  assert.equal(new Set(occupied).size, 1);
  assert.ok(colorEnergy(occupied[0]!) < colorEnergy(unoccupied[0]!));
});

test("starting reveals future targets beyond the occupied platforms", () => {
  const game = createGame({ playerCount: 4, seed: 404 });
  game.init(0);
  game.playerReadyZones().forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 }));
  game.tick({ atMillis: 1_600 });
  const zones = game.playerReadyZones();
  const outsideLit = game.render().cells.filter((cell) => (
    cell.color !== "#03060b"
    && !zones.some((zone) => cell.x >= zone.minX && cell.x <= zone.maxX && cell.y >= zone.minY && cell.y <= zone.maxY)
  ));
  assert.ok(outsideLit.length > 0);
});

test("a fast target hit awards the owner points and immediately respawns", () => {
  const game = start(2);
  const before = game.snapshot();
  const target = before.targets[1]!;
  const events = game.press({ x: target.x, y: target.y, pressed: true, atMillis: 3_250 });
  const after = game.snapshot();
  assert.equal(events[0]?.cue, "mole-hit");
  assert.ok((after.playerProgress[1]?.score ?? 0) >= 4);
  assert.equal(after.targets.length, 2);
  assert.notDeepEqual(after.targets[1], target);
});

test("expired targets respawn with catch-up time and misses do not score", () => {
  const game = start(1);
  const score = game.snapshot().score;
  const emptyEvents = game.press({ x: 15, y: 31, pressed: true, atMillis: 3_250 });
  assert.deepEqual(emptyEvents, []);
  assert.equal(game.snapshot().score, score);
  const deadline = game.snapshot().targets[0]!.deadlineMillis;
  const events = game.tick({ atMillis: deadline + 1 });
  assert.equal(events[0]?.cue, "target-expired");
  assert.equal(game.snapshot().targets.length, 1);
  assert.ok(game.snapshot().targets[0]!.remainingMillis > 2_000);
});

test("time selects a winner, locks scoring, and resets after celebration", () => {
  const game = start(2, 3_000);
  const target = game.snapshot().targets[1]!;
  game.press({ x: target.x, y: target.y, pressed: true, atMillis: 3_300 });
  game.tick({ atMillis: 6_300 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().winnerIndex, 1);
  const score = game.snapshot().score;
  game.press({ x: 0, y: 0, pressed: true, atMillis: 6_400 });
  assert.equal(game.snapshot().score, score);
  game.tick({ atMillis: 10_400 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("fixtures and Spanish display cover active play and winner", () => {
  assert.equal(runningSnapshot.targets.length, 4);
  assert.equal(finishedSnapshot.phase, "finished");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: finishedSnapshot }));
  assert.match(html, /Atrapa al topo/);
  assert.match(html, /topos atrapados/);
});

test("prepared recordings reach countdown, hit, expiration, and victory through real engine input", () => {
  const expectedPhases = new Map([
    ["countdown", "starting"],
    ["hit", "running"],
    ["expired", "running"],
    ["victory", "finished"]
  ]);
  for (const scenario of playtestScenarios) {
    const game = createGame({ playerCount: 4, seed: 404, durationMillis: 60_000 });
    const engine = createGameEngine(game, { initialEvents: game.init(0) });
    const preparation = scenario.prepare({
      get clockMillis() { return engine.clockMillis; },
      get state() { return engine.state; },
      game,
      press: (x, y) => { engine.press(x, y); },
      release: (x, y) => { engine.release(x, y); },
      step: (deltaMillis) => { engine.step(deltaMillis); }
    });
    for (const action of preparation.trigger) applyScenarioAction(engine, action);
    assert.equal(game.snapshot().phase, expectedPhases.get(scenario.id), scenario.id);
    if (scenario.id === "hit") assert.ok(game.snapshot().score > 0);
    if (scenario.id === "expired") assert.equal(engine.state.events[0]?.cue, "target-expired");
  }
});

function zoneColors(frame: Frame, zone: PlayerReadyZone): string[] {
  return frame.cells
    .filter((cell) => cell.x >= zone.minX && cell.x <= zone.maxX && cell.y >= zone.minY && cell.y <= zone.maxY)
    .map((cell) => cell.color);
}

function colorEnergy(color: string): number {
  const value = color.replace("#", "");
  return [0, 2, 4].reduce((sum, offset) => sum + Number.parseInt(value.slice(offset, offset + 2), 16), 0);
}

function applyScenarioAction(
  engine: ReturnType<typeof createGameEngine>,
  action: GamePlaytestAction
): void {
  if (action.type === "press") engine.press(action.x, action.y);
  else if (action.type === "release") engine.release(action.x, action.y);
  else engine.step(action.deltaMillis);
}
