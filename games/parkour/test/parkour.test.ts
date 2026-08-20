import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  createSessionController,
  fallbackContent,
  finishedSnapshot,
  manifest,
  parkourEngineGame,
  parkourGameId,
  runningFrame,
  runningSnapshot
} from "../src/index.ts";
import { testContent } from "../src/test-fixtures-content.ts";

test("Parkour keeps the platform UUID canonical and the legacy engine name as an alias", () => {
  assert.equal(manifest.id, parkourGameId);
  assert.equal(manifest.slug, parkourEngineGame);
  assert.deepEqual(manifest.aliases, [parkourEngineGame]);
  assert.deepEqual(manifest.players, { allowAny: true, min: 1, max: 8 });
  assert.equal(manifest.preview.playerCount, 0);
  assert.equal(fallbackContent.gameId, parkourGameId);
  assert.equal(fallbackContent.engineGame, parkourEngineGame);
  assert.ok(fallbackContent.contentRevision.length > 0);
  assert.equal(typeof createSessionController, "function");
});

test("Parkour Any mode normalizes an unspecified roster to one live player", () => {
  const game = createGame({ playerCount: 0, difficulty: "easy", content: testContent });
  game.init(0);
  assert.equal(game.snapshot().playerCount, 1);
  assert.ok(game.playerReadyZones().length >= 1);
});

test("Parkour captures a connected blue platform and advances after its result animation", () => {
  const game = createGame({ playerCount: 1, difficulty: "medium", content: testContent });
  game.init(0);
  assert.equal(game.snapshot().phase, "countdown");
  game.tick({ atMillis: 3_000 });
  assert.equal(game.snapshot().phase, "running");
  assert.equal(frameCell(game.render(), 7, 5)?.color, "#0000ff");

  game.press({ x: 7, y: 5, pressed: true, atMillis: 3_020 });
  game.tick({ atMillis: 3_040 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().score, 3);
  assert.equal(game.snapshot().success, true);

  game.tick({ atMillis: 4_291 });
  assert.equal(game.snapshot().phase, "countdown");
  assert.equal(game.snapshot().level, "11111111-1111-4111-8111-111111111102");
  assert.equal(game.snapshot().levelSlug, "level-2");
});

test("Parkour lava uses per-tile damage cooldown and difficulty lives", () => {
  const game = createGame({ playerCount: 1, difficulty: "hard", content: testContent });
  game.init(0);
  game.tick({ atMillis: 3_000 });
  assert.equal(game.snapshot().maxLives, 2);
  game.press({ x: 0, y: 0, pressed: true, atMillis: 3_020 });
  assert.equal(game.snapshot().lives, 1);
  game.release({ x: 0, y: 0, pressed: false, atMillis: 3_040 });
  game.press({ x: 0, y: 0, pressed: true, atMillis: 3_060 });
  assert.equal(game.snapshot().lives, 1);
  game.press({ x: 1, y: 0, pressed: true, atMillis: 3_080 });
  assert.equal(game.snapshot().lives, 0, "a different red tile can damage immediately");
  assert.equal(game.snapshot().phase, "finished");
});

test("Parkour fixtures and shared Spanish display render", () => {
  assert.equal(runningSnapshot.currentGame, parkourGameId);
  assert.equal(finishedSnapshot.success, true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: runningSnapshot,
    frame: runningFrame
  }));
  assert.match(html, /Parkour/);
  assert.match(html, /Puntos/);
  assert.match(html, /Vidas/);
  assert.match(html, /Juego en el suelo/);
  assert.match(html, /Quedan 3 objetivos/);
  assert.doesNotMatch(html, /Prepárate/);
  assert.doesNotMatch(html, />Player /);

  const elapsedGame = createGame({ playerCount: 1, difficulty: "medium", content: testContent });
  elapsedGame.init(0);
  elapsedGame.tick({ atMillis: 5_000 });
  const elapsedHtml = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: elapsedGame.snapshot(),
    frame: elapsedGame.render()
  }));
  assert.match(elapsedHtml, /0:02/, "untimed best-time challenges display elapsed time");
});
