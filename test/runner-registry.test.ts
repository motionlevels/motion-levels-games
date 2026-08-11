import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gameManifestLookupKeys, gameManifestSlug } from "../packages/game-sdk/src/index.ts";
import { buildGameRegistry, gameCatalog, gamePackageRegistry, gameRegistry } from "../packages/runner/src/registry.ts";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gameIds = (await readdir(path.join(repoRoot, "games"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("production runner and player display registries cover every game package", () => {
  const registeredIds = [...gamePackageRegistry.keys()].sort();
  assert.deepEqual(
    registeredIds,
    gameIds,
    "register every games/* package in packages/runner/src/registry.ts before release",
  );
  assert.deepEqual(gameCatalog.map(gameManifestSlug).sort(), gameIds);

  for (const [gameId, gameModule] of gamePackageRegistry) {
    assert.equal(gameManifestSlug(gameModule.manifest), gameId);
    assert.equal(typeof gameModule.createGame, "function", `${gameId} must register its game factory`);
    assert.equal(typeof gameModule.PlayerDisplay, "function", `${gameId} must register its player display`);
    for (const lookupKey of gameManifestLookupKeys(gameModule.manifest)) {
      assert.equal(gameRegistry.get(lookupKey), gameModule, `${lookupKey} must resolve uniquely`);
    }
  }
});

test("runner rejects canonical-id, slug, and historical-alias collisions", () => {
  const [first, second] = [...gamePackageRegistry.values()];
  assert.ok(first && second);
  assert.throws(() => buildGameRegistry([
    { ...first, manifest: { ...first.manifest, aliases: ["Shared-Name"] } },
    { ...second, manifest: { ...second.manifest, aliases: ["shared-name"] } }
  ]), /game identity collision: shared-name/u);
});
