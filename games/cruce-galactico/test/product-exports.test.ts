import assert from "node:assert/strict";
import test from "node:test";
import * as product from "../src/product.ts";

test("product subpath exposes only the production game and display surface", () => {
  assert.deepEqual(Object.keys(product).sort(), [
    "PlayerDisplay",
    "checkpointTarget",
    "createGame",
    "damageImmunityMillis",
    "gameWinAnimationMillis",
    "manifest",
    "startingLives"
  ]);
  assert.equal(product.manifest.id, "cruce-galactico");
  assert.equal(typeof product.createGame, "function");
  assert.equal(typeof product.PlayerDisplay, "function");

  const game = product.createGame({ playerCount: 1, seed: 137 });
  game.init(0);
  assert.equal(game.snapshot().checkpointTarget, product.checkpointTarget);
});
