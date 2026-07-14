import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplay, createGame, finishedSnapshot, manifest, patternTargets, patronesCelebrationMillis, runningFrame, runningSnapshot, waitingSnapshot } from "../src/index.ts";

function start(game: ReturnType<typeof createGame>) {
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
}

test("manifest describes the Motion Go Patrones successor", () => {
  assert.equal(manifest.id, "patrones");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: true, min: 1, max: 1 });
});

test("difficulty changes pattern density deterministically", () => {
  assert.ok(patternTargets("easy").length < patternTargets("medium").length);
  assert.ok(patternTargets("medium").length < patternTargets("hard").length);
  assert.deepEqual(patternTargets("hard"), patternTargets("hard"));
});

test("correct targets complete the pattern and lock scoring during celebration", () => {
  const game = createGame({ playerCount: 0, difficulty: "easy" });
  start(game);
  patternTargets("easy").forEach((target, index) => game.press({ ...target, pressed: true, atMillis: 2_200 + index * 10 }));
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, true);
  assert.equal(game.snapshot().score, patternTargets("easy").length);
  game.press({ x: 0, y: 0, pressed: true, atMillis: 2_500 });
  assert.equal(game.snapshot().success, true);
  game.tick({ atMillis: 2_200 + patternTargets("easy").length * 10 + patronesCelebrationMillis });
  assert.equal(game.snapshot().phase, "waiting");
});

test("an incorrect tile ends the attempt", () => {
  const game = createGame({ playerCount: 1, difficulty: "medium" });
  start(game);
  game.press({ x: 0, y: 0, pressed: true, atMillis: 2_200 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().success, false);
  assert.equal(game.snapshot().lastEventMessage, "Baldosa incorrecta");
});

test("fixtures and Spanish display cover the primary states", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(finishedSnapshot.success, true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame }));
  assert.match(html, /Aciertos/);
  assert.match(html, /Objetivos/);
  assert.match(html, /Reconstruye el patrón azul/);
  assert.doesNotMatch(html, /Score|Lives|Message/);
});
