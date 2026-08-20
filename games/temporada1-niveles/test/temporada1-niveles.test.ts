import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublishedLevelContent } from "@motion-levels-games/published-level-runtime";
import {
  PlayerDisplay,
  createGame,
  createSessionController,
  fallbackContent,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  temporada1EngineGame,
  temporada1GameId
} from "../src/index.ts";
import { testContent } from "../src/test-fixtures-content.ts";

test("Temporada 1 keeps the platform UUID canonical and supports the legacy alias", () => {
  assert.equal(manifest.id, temporada1GameId);
  assert.equal(manifest.slug, temporada1EngineGame);
  assert.deepEqual(manifest.aliases, [temporada1EngineGame]);
  assert.equal(fallbackContent.gameId, temporada1GameId);
  assert.equal(fallbackContent.engineGame, temporada1EngineGame);
  assert.equal(typeof createSessionController, "function");
});

test("Temporada 1 preserves blue and purple objective semantics", () => {
  const game = createGame({ playerCount: 4, difficulty: "medium", content: testContent });
  game.init(0);
  game.tick({ atMillis: 3_000 });
  game.press({ x: 2, y: 5, pressed: true, atMillis: 3_020 });
  game.press({ x: 13, y: 24, pressed: true, atMillis: 3_040 });
  assert.equal(game.snapshot().score, 2);

  game.press({ x: 8, y: 14, pressed: true, atMillis: 3_060 });
  assert.equal(game.snapshot().score, 2);
  assert.equal(game.semanticTiles().find((tile) => tile.uniq === "purple-0")?.kind, 4);
  game.release({ x: 8, y: 14, pressed: false, atMillis: 3_080 });
  assert.equal(game.semanticTiles().find((tile) => tile.uniq === "purple-0")?.primed, true);
  game.press({ x: 8, y: 14, pressed: true, atMillis: 3_100 });
  game.tick({ atMillis: 3_120 });
  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().score, 13);
  assert.equal(game.snapshot().success, true);
});

test("Temporada 1 supports six Spanish-labelled players and every authored difficulty", () => {
  const game = createGame({ playerCount: 6, difficulty: "expert", content: testContent });
  game.init(0);
  assert.equal(game.snapshot().playerCount, 6);
  assert.deepEqual(game.snapshot().players.map((player) => player.label), [
    "Jugador 1",
    "Jugador 2",
    "Jugador 3",
    "Jugador 4",
    "Jugador 5",
    "Jugador 6"
  ]);
  assert.equal(game.snapshot().maxLives, 2);
  game.tick({ atMillis: 3_000 });
  assert.equal(game.snapshot().remainingMillis, 45_000);
});

test("free mode disables the challenge timer without freezing editor content", () => {
  const freeContent = createPublishedLevelContent({
    gameId: temporada1GameId,
    engineGame: temporada1EngineGame,
    selectedLevelId: fallbackContent.selectedLevelId,
    selectedLevelSlug: fallbackContent.selectedLevelSlug,
    mode: "free",
    levelsPayload: fallbackContent.levels,
    resultAnimationsPayload: fallbackContent.resultAnimations
  });
  const game = createGame({ playerCount: 1, difficulty: "hard", content: freeContent });
  game.init(0);
  game.tick({ atMillis: 5_000 });
  assert.equal(game.snapshot().mode, "free");
  assert.equal(game.snapshot().remainingMillis, 0);
  assert.equal(game.snapshot().audio.musicRef, "Motion/canciones/Background07.mp3");
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: game.snapshot(),
    frame: game.render()
  }));
  assert.match(html, /0:02/, "free mode displays elapsed time");
  assert.doesNotMatch(html, /Prepárate/);
});

test("running display shows only recent semantic events, then returns to the objective", () => {
  const game = createGame({ playerCount: 1, difficulty: "medium", content: testContent });
  game.init(0);
  game.tick({ atMillis: 3_000 });
  game.press({ x: 0, y: 8, pressed: true, atMillis: 3_020 });
  let html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: game.snapshot(),
    frame: game.render()
  }));
  assert.match(html, /Impacto: quedan 3 vidas/);
  game.release({ x: 0, y: 8, pressed: false, atMillis: 3_021 });
  game.tick({ atMillis: 5_600 });
  html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: game.snapshot(),
    frame: game.render()
  }));
  assert.doesNotMatch(html, /Impacto:/);
  assert.match(html, /Quedan 3 objetivos/);
});

test("Temporada fixtures and shared Spanish display render", () => {
  assert.equal(runningSnapshot.currentGame, temporada1GameId);
  assert.equal(finishedSnapshot.success, true);
  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: runningSnapshot,
    frame: runningFrame
  }));
  assert.match(html, /Temporada 1/);
  assert.match(html, /Puntos/);
  assert.match(html, /Vidas/);
  assert.match(html, /Tiempo/);
  assert.match(html, /1:15/, "challenge mode displays remaining time");
  assert.match(html, /Quedan 3 objetivos/);
  assert.doesNotMatch(html, /Prepárate/);
  assert.doesNotMatch(html, />Player /);
});
