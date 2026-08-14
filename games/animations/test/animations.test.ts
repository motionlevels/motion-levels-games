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

test("apagado ignores pressure without reporting a false interaction", () => {
  const game = createGame({ options: { animation: "apagado", mode: "single", speed: 1, rotationSeconds: 20 } });
  game.init(0);
  const events = game.press({ x: 8, y: 16, pressed: true, atMillis: 200 });
  assert.deepEqual(events, []);
  assert.equal(game.snapshot().activeTargets, 0);
  assert.notEqual(game.snapshot().lastEventCue, "effect");
  assert.ok(game.render().cells.every((cell) => cell.color === "#000000"));
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

test("the default rotation stays lit and leaves apagado as an explicit choice", () => {
  const game = createGame({ options: { mode: "rotation", speed: 1, rotationSeconds: 5 } });
  game.init(0);
  assert.notEqual(game.snapshot().animationId, "apagado");
  assert.equal(game.snapshot().rotationSize, animationLibrary.length - 1);
  assert.ok(game.render().cells.some((cell) => cell.color !== "#000000"));
});

test("every library entry can be selected and rendered", () => {
  for (const animation of animationLibrary) {
    const game = createGame({ options: { animation: animation.id, mode: "single", speed: 1, rotationSeconds: 20 } });
    game.init(0);
    assert.equal(game.snapshot().animationId, animation.id);
    assert.equal(game.render().cells.length, 512);
  }
});
