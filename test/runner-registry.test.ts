import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gameCatalog, gameRegistry } from "../packages/runner/src/registry.ts";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gameIds = (await readdir(path.join(repoRoot, "games"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("production runner and player display registries cover every game package", () => {
  const registeredIds = [...gameRegistry.keys()].sort();
  assert.deepEqual(
    registeredIds,
    gameIds,
    "register every games/* package in packages/runner/src/registry.ts before release",
  );
  assert.deepEqual(gameCatalog.map((game) => game.id), gameIds);

  for (const [gameId, gameModule] of gameRegistry) {
    assert.equal(gameModule.manifest.id, gameId);
    assert.equal(typeof gameModule.createGame, "function", `${gameId} must register its game factory`);
    assert.equal(typeof gameModule.PlayerDisplay, "function", `${gameId} must register its player display`);
  }
});
