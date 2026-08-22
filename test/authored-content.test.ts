import assert from "node:assert/strict";
import test from "node:test";
import { compileAuthoredContent } from "../scripts/authored-content.ts";
import { gamePackageRegistry } from "../packages/game-catalog/src/gameplayRegistry.ts";
import { FLOOR_COLS, FLOOR_ROWS } from "@motion-levels-games/game-sdk";

test("repository-authored catalogs compile deterministically and every level initializes offline", async () => {
  const first = await compileAuthoredContent({ check: true });
  const second = await compileAuthoredContent({ check: true });
  assert.deepEqual(
    first.map((game) => [game.gameDir, game.content.contentRevision]),
    second.map((game) => [game.gameDir, game.content.contentRevision])
  );
  assert.deepEqual(first.map((game) => game.gameDir), ["parkour", "temporada1-niveles"]);
  assert.deepEqual(first[0]?.game.resultAnimationIds, first[1]?.game.resultAnimationIds);
  assert.deepEqual(first[0]?.content.resultAnimations, first[1]?.content.resultAnimations);

  for (const compiled of first) {
    const module = gamePackageRegistry.get(compiled.game.engineGame);
    assert.ok(module, `${compiled.game.engineGame} must be registered as a concrete game`);
    const playerCount = module.manifest.players.allowAny ? 0 : module.manifest.players.min;
    for (const level of compiled.content.levels) {
      const game = module.createGame({
        difficulty: level.difficulty,
        playerCount,
        nowMillis: 0,
        durationMillis: 0,
        contentSelection: { levelId: level.id, mode: "challenge" }
      });
      game.init(0);
      const frame = game.render();
      assert.equal(frame.cells.length, FLOOR_COLS * FLOOR_ROWS, `${compiled.game.engineGame}/${level.id} render`);
      for (let tick = 100; tick <= 2_000; tick += 100) {
        game.tick({ atMillis: tick });
      }
      const snapshot = game.snapshot() as unknown as { contentRevision?: string };
      assert.equal(snapshot.contentRevision, compiled.content.contentRevision);
    }
  }
});
