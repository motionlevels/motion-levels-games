import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DisplayStatus } from "../src/api.ts";
import { GamesRendererFallback } from "../src/GamesRendererFallback.tsx";

const status = {
  currentGame: "motion-levels-games:guardianes",
  elapsedMillis: 12_000,
  label: "Guardianes",
  lifecycle: "running",
  lives: 3,
  remainingMillis: 48_000,
  score: 7
} as DisplayStatus;

test("revision recovery remains generic and preserves essential live state", () => {
  const html = renderToStaticMarkup(React.createElement(GamesRendererFallback, {
    connected: true,
    error: "",
    status
  }));

  assert.match(html, /Preparando la pantalla del juego/);
  assert.match(html, /Guardianes/);
  assert.match(html, /Motor conectado/);
  assert.match(html, /0:48/);
  assert.match(html, />7</);
  assert.match(html, />3</);
  assert.doesNotMatch(html, /guardianes-|ping-pong-|memoria-v2-|duelo-/);
});

test("revision recovery surfaces a renderer failure without inventing game UI", () => {
  const html = renderToStaticMarkup(React.createElement(GamesRendererFallback, {
    connected: false,
    error: "No se pudo cargar la pantalla del juego",
    status
  }));

  assert.match(html, /Sin conexión/);
  assert.match(html, /No se pudo cargar la pantalla del juego/);
});
