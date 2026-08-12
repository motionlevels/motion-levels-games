import assert from "node:assert/strict";
import test from "node:test";
import { animationLibrary, defineAnimation, findAnimation, renderAnimationFrame, solid } from "../src/index.ts";

test("the native library exposes unique, production-sized animations", () => {
  assert.ok(animationLibrary.length >= 24);
  assert.equal(new Set(animationLibrary.map((animation) => animation.id)).size, animationLibrary.length);
  assert.ok(animationLibrary.some((animation) => animation.id === "neon-ribbons"));
  assert.ok(animationLibrary.some((animation) => animation.id === "bioluminescence"));
  assert.ok(animationLibrary.every((animation) => animation.palette.length >= 3));
});

test("rendering is deterministic and always fills the hardware floor", () => {
  const animation = findAnimation("prism-tunnel");
  const first = renderAnimationFrame(animation, { atMillis: 4_321, seed: 99 });
  const second = renderAnimationFrame(animation, { atMillis: 4_321, seed: 99 });
  assert.deepEqual(first, second);
  assert.equal(first.cells.length, 16 * 32);
  assert.ok(first.cells.every((cell) => /^#[0-9a-f]{6}$/u.test(cell.color)));
});

test("loop time wraps and pressure creates a visible deterministic overlay", () => {
  const animation = findAnimation("aurora");
  assert.deepEqual(
    renderAnimationFrame(animation, { atMillis: 123 }),
    renderAnimationFrame(animation, { atMillis: animation.durationMillis + 123 })
  );
  assert.notDeepEqual(
    renderAnimationFrame(animation, { atMillis: 500 }),
    renderAnimationFrame(animation, { atMillis: 500, pressure: [{ x: 8, y: 16, startedAtMillis: 300 }] })
  );
});

test("definition validation rejects unstable identifiers and invalid durations", () => {
  assert.throws(() => defineAnimation({ id: "Not valid", label: "Bad", description: "Bad", category: "ambient", durationMillis: 1_000, palette: ["#000000"], tags: [], render: solid("#000000") }));
  assert.throws(() => defineAnimation({ id: "bad", label: "Bad", description: "Bad", category: "ambient", durationMillis: 10, palette: ["#000000"], tags: [], render: solid("#000000") }));
});
