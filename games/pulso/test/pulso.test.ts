import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  comboSnapshot,
  createGame,
  failedSnapshot,
  finishedSnapshot,
  manifest,
  pulseChart,
  pulseDifficultyProfile,
  pulsePads,
  runningFrame,
  runningSnapshot,
  startingEnergy
} from "../src/index.ts";

function startGame(playerCount = 0, difficulty = "medium") {
  const game = createGame({ playerCount, difficulty, durationMillis: manifest.defaultDurationMillis });
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  return game;
}

test("manifest exposes a production cooperative Any or one-to-eight player rhythm game", () => {
  assert.equal(manifest.id, "pulso");
  assert.equal(manifest.availability.production, true);
  assert.equal(manifest.players.allowAny, true);
  assert.equal(manifest.players.min, 1);
  assert.equal(manifest.players.max, 8);
  assert.equal(manifest.start.mode, "player-ready");
});

test("Any and eight-player modes preserve the same shared readiness and chart", () => {
  for (const playerCount of [0, 8]) {
    const game = createGame({ playerCount });
    game.init(0);
    game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
    assert.equal(game.snapshot().phase, "starting");
    game.tick({ atMillis: 2_100 });
    assert.equal(game.snapshot().phase, "running");
    assert.equal(game.snapshot().noteCount, pulseChart().length);
  }
});

test("leaving the central platform cancels the countdown after release grace", () => {
  const game = createGame({ playerCount: 0 });
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.release({ x: 8, y: 16, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 1_500 });
  assert.equal(game.snapshot().phase, "waiting");
});

test("difficulty changes tempo and timing windows deterministically", () => {
  assert.ok(pulseChart("expert")[1]!.atMillis < pulseChart("easy")[1]!.atMillis);
  assert.ok(pulseDifficultyProfile("expert").timingWindowMillis < pulseDifficultyProfile("easy").timingWindowMillis);
  assert.deepEqual(pulseChart("hard"), pulseChart("hard"));
});

test("tap notes and simultaneous chords build a shared combo and energy", () => {
  const game = startGame();
  for (const note of pulseChart().slice(0, 5)) {
    for (const zone of note.zones) {
      const pad = pulsePads[zone]!;
      game.press({ x: pad.x, y: pad.y, pressed: true, atMillis: 2_100 + note.atMillis });
    }
  }
  assert.equal(game.snapshot().noteIndex, 5);
  assert.equal(game.snapshot().combo, 5);
  assert.ok(game.snapshot().energy > startingEnergy);
  assert.equal(game.snapshot().accuracy, 100);
});

test("hold notes require staying on the illuminated zone", () => {
  const game = startGame();
  const chart = pulseChart();
  for (const note of chart.slice(0, 6)) {
    for (const zone of note.zones) {
      const pad = pulsePads[zone]!;
      game.press({ x: pad.x, y: pad.y, pressed: true, atMillis: 2_100 + note.atMillis });
    }
  }
  const hold = chart[6]!;
  const holdPad = pulsePads[hold.zones[0]!]!;
  game.press({ x: holdPad.x, y: holdPad.y, pressed: true, atMillis: 2_100 + hold.atMillis });
  assert.equal(game.snapshot().noteKind, "hold");
  game.tick({ atMillis: 2_100 + hold.atMillis + hold.holdMillis });
  assert.equal(game.snapshot().noteIndex, 7);

  const retry = startGame();
  for (const note of chart.slice(0, 6)) {
    for (const zone of note.zones) {
      const pad = pulsePads[zone]!;
      retry.press({ x: pad.x, y: pad.y, pressed: true, atMillis: 2_100 + note.atMillis });
    }
  }
  retry.press({ x: holdPad.x, y: holdPad.y, pressed: true, atMillis: 2_100 + hold.atMillis });
  retry.release({ x: holdPad.x, y: holdPad.y, pressed: false, atMillis: 2_100 + hold.atMillis + 100 });
  assert.equal(retry.snapshot().combo, 0);
  assert.equal(retry.snapshot().noteIndex, 7);
});

test("misses drain energy and zero energy starts a locked failure animation", () => {
  const game = startGame();
  const profile = pulseDifficultyProfile("medium");
  for (const note of pulseChart().slice(0, 6)) {
    game.tick({ atMillis: 2_100 + note.atMillis + profile.timingWindowMillis + 1 });
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, false);
  assert.equal(game.snapshot().energy, 0);
  const before = game.snapshot().noteIndex;
  game.press({ x: pulsePads[0].x, y: pulsePads[0].y, pressed: true, atMillis: 10_000 });
  assert.equal(game.snapshot().noteIndex, before);
});

test("completing the deterministic chart starts a distinct game-win animation", () => {
  const game = startGame();
  for (const note of pulseChart()) {
    for (const zone of note.zones) {
      const pad = pulsePads[zone]!;
      game.press({ x: pad.x, y: pad.y, pressed: true, atMillis: 2_100 + note.atMillis });
    }
    if (note.holdMillis > 0) {
      game.tick({ atMillis: 2_100 + note.atMillis + note.holdMillis });
    }
  }
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().score, pulseChart().length);
  assert.notEqual(frameCell(game.render(), 8, 16)?.color, frameCell(runningFrame, 8, 16)?.color);
});

test("fixtures and Spanish display cover running, combo, failure, and victory", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  assert.ok(comboSnapshot.combo >= 7);
  assert.equal(failedSnapshot.energy, 0);
  assert.equal(finishedSnapshot.success, true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: comboSnapshot, frame: runningFrame }));
  assert.match(html, /Energía/);
  assert.match(html, /Precisión/);
  assert.match(html, /Pista/);
  assert.doesNotMatch(html, /Energy|Accuracy|Waiting|Player/);
});
