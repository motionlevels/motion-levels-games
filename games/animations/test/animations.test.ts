import assert from "node:assert/strict";
import test from "node:test";
import { animationLibrary } from "@motion-levels-games/animation-runtime";
import { animationContentSchema, createGame } from "../src/game.ts";

test("ambient animation starts immediately and responds to pressure", () => {
  const game = createGame({ seed: 44, options: { animation: "neon-ribbons", mode: "single", speed: 1, rotationSeconds: 20 } });
  game.init(0);
  assert.equal(game.snapshot().phase, "running");
  assert.equal(game.snapshot().animationId, "neon-ribbons");
  const before = game.render();
  game.press({ x: 8, y: 16, pressed: true, atMillis: 200 });
  assert.equal(game.snapshot().activeTargets, 1);
  assert.notDeepEqual(game.render(), before);
  game.tick({ atMillis: 1_200 });
  assert.equal(game.snapshot().activeTargets, 0);
});

test("rotation uses the immutable host content snapshot", () => {
  const game = createGame({
    options: { animation: "aurora", mode: "rotation", speed: 1, rotationSeconds: 20 },
    content: {
      schema: animationContentSchema,
      contentRevision: "sha256:fixture",
      rotationIds: ["aurora", "prism-tunnel"],
      rotationSeconds: 5
    }
  });
  game.init(0);
  assert.equal(game.snapshot().animationId, "aurora");
  game.tick({ atMillis: 5_000 });
  assert.equal(game.snapshot().animationId, "prism-tunnel");
  assert.equal(game.snapshot().contentRevision, "sha256:fixture");
  assert.equal(game.snapshot().rotationSize, 2);
});

test("rotation ignores platform ids that are not in the native library", () => {
  const game = createGame({
    options: { mode: "rotation", rotationSeconds: 5 },
    content: {
      schema: animationContentSchema,
      contentRevision: "sha256:platform",
      rotationIds: ["missing-authored-animation", "prism-tunnel", "missing-again"],
      rotationSeconds: 5
    }
  });
  game.init(0);
  assert.equal(game.snapshot().animationId, "prism-tunnel");
  assert.equal(game.snapshot().rotationSize, 1);
});

test("every library entry can be selected and rendered", () => {
  for (const animation of animationLibrary) {
    const game = createGame({ options: { animation: animation.id, mode: "single", speed: 1, rotationSeconds: 20 } });
    game.init(0);
    assert.equal(game.snapshot().animationId, animation.id);
    assert.equal(game.render().cells.length, 512);
  }
});
