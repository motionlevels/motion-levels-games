import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplay, createGame, damagedSnapshot, lavaCelebrationMillis, lavaDamageImmunityMillis, lavaStartingLives, manifest, runningFrame, runningSnapshot, waitingSnapshot } from "../src/index.ts";

function start(game: ReturnType<typeof createGame>) { game.init(0); game.press({ x: 8, y: 16, pressed: true, atMillis: 100 }); game.tick({ atMillis: 2_100 }); game.tick({ atMillis: 4_000 }); }

test("manifest describes the Motion Go lava successor", () => { assert.equal(manifest.id, "lava"); assert.equal(manifest.availability.production, true); assert.equal(manifest.players.allowAny, true); });
test("platform movement is deterministic for a seed and difficulty", () => { const left = createGame({ playerCount: 0, seed: 137, difficulty: "hard" }); const right = createGame({ playerCount: 1, seed: 137, difficulty: "hard" }); start(left); start(right); assert.deepEqual(left.snapshot().safePlatforms, right.snapshot().safePlatforms); assert.ok(left.snapshot().safePlatforms.length > 0); });
test("safe platforms score while lava costs lives with immunity", () => {
  const game = createGame({ playerCount: 1, seed: 137 }); start(game); const safe = game.snapshot().safePlatforms[0]; assert.ok(safe);
  game.press({ x: safe.x, y: safe.y + safe.height - 1, pressed: true, atMillis: 4_100 }); assert.equal(game.snapshot().score, 1);
  game.press({ x: 15, y: 31, pressed: true, atMillis: 4_200 }); assert.equal(game.snapshot().lives, 2);
  game.press({ x: 14, y: 31, pressed: true, atMillis: 4_200 + lavaDamageImmunityMillis - 1 }); assert.equal(game.snapshot().lives, 2);
});
test("three separated lava hits lose and surviving the minute wins", () => {
  const lost = createGame({ playerCount: 1, seed: 137 }); start(lost); for (let index = 0; index < lavaStartingLives; index += 1) lost.press({ x: 15, y: 31, pressed: true, atMillis: 4_200 + index * lavaDamageImmunityMillis });
  assert.equal(lost.snapshot().phase, "finished"); assert.equal(lost.snapshot().success, false); assert.equal(lost.snapshot().lives, 0);
  lost.tick({ atMillis: 4_200 + 2 * lavaDamageImmunityMillis + lavaCelebrationMillis }); assert.equal(lost.snapshot().phase, "waiting");
  const won = createGame({ playerCount: 1, seed: 137, durationMillis: 60_000 }); start(won); won.tick({ atMillis: 62_100 }); assert.equal(won.snapshot().success, true);
});
test("fixtures and Spanish display cover lives and running state", () => { assert.equal(waitingSnapshot.phase, "waiting"); assert.equal(runningSnapshot.phase, "running"); assert.equal(damagedSnapshot.lives, 2); const html = renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot: runningSnapshot, frame: runningFrame })); assert.match(html, /Plataformas/); assert.match(html, /Tiempo/); assert.match(html, /ml-lives-meter/); assert.doesNotMatch(html, /Score|Lives|Message/); });
