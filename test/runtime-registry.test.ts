import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gameManifestLookupKeys, gameManifestSlug } from "../packages/game-sdk/src/index.ts";
import { displayRegistry } from "../packages/game-catalog/src/displayRegistry.ts";
import {
  gameCatalog,
  gamePackageRegistry,
  gameplayRegistry
} from "../packages/game-catalog/src/gameplayRegistry.ts";
import { buildGameplayRegistry } from "../packages/runtime/src/registry.ts";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gameIds = (await Promise.all(
  (await readdir(path.join(repoRoot, "games"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const packageJson = JSON.parse(await readFile(path.join(repoRoot, "games", entry.name, "package.json"), "utf8")) as {
        exports?: Record<string, unknown>;
      };
      return packageJson.exports?.["./game"] ? entry.name : null;
    })
)).filter((gameId): gameId is string => gameId !== null).sort();

test("gameplay and browser display registries cover every playable game package", () => {
  assert.deepEqual(
    [...gamePackageRegistry.keys()].sort(),
    gameIds,
    "register every games/* package in packages/game-catalog/src/gameplayRegistry.ts before release"
  );
  assert.deepEqual(gameCatalog.map(gameManifestSlug).sort(), gameIds);

  for (const [gameId, gameModule] of gamePackageRegistry) {
    assert.equal(gameManifestSlug(gameModule.manifest), gameId);
    assert.equal(typeof gameModule.createGame, "function", `${gameId} must register its game factory`);
    for (const lookupKey of gameManifestLookupKeys(gameModule.manifest)) {
      assert.equal(gameplayRegistry.get(lookupKey), gameModule, `${lookupKey} must resolve uniquely`);
      assert.equal(typeof displayRegistry.get(lookupKey)?.PlayerDisplay, "function", `${gameId} must register its browser display`);
    }
  }

  assert.equal(gameplayRegistry.get("salvapantallas"), gamePackageRegistry.get("animations"));
});

test("gameplay registry rejects canonical-id, slug, and historical-alias collisions", () => {
  const [first, second] = [...gamePackageRegistry.values()];
  assert.ok(first && second);
  assert.throws(() => buildGameplayRegistry([
    { ...first, manifest: { ...first.manifest, aliases: ["Shared-Name"] } },
    { ...second, manifest: { ...second.manifest, aliases: ["shared-name"] } }
  ]), /game identity collision: shared-name/u);
});
