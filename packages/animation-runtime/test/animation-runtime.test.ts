import assert from "node:assert/strict";
import test from "node:test";
import {
  animationContentSchema,
  animationLibrary,
  animationMediaCatalogEntry,
  animationMediaReferences,
  animationMediaSchema,
  animationMediaURL,
  animationPreviewRecipe,
  defineAnimation,
  findAnimation,
  normalizeAnimationRuntimeContent,
  renderAnimationFrame,
  solid
} from "../src/index.ts";

test("runtime content is normalized at the package boundary", () => {
  assert.deepEqual(normalizeAnimationRuntimeContent({
    schema: animationContentSchema,
    contentRevision: "revision-1",
    selectedAnimationId: " Aurora ",
    rotationIds: ["Aurora", "aurora", "PRISM-TUNNEL", 42],
    rotationSeconds: 2
  }), {
    schema: animationContentSchema,
    contentRevision: "revision-1",
    selectedAnimationId: "aurora",
    rotationIds: ["aurora", "prism-tunnel"],
    rotationSeconds: 5
  });
});

test("the native library exposes unique, production-sized animations", () => {
  assert.ok(animationLibrary.length >= 24);
  assert.equal(new Set(animationLibrary.map((animation) => animation.id)).size, animationLibrary.length);
  assert.ok(animationLibrary.some((animation) => animation.id === "neon-ribbons"));
  assert.ok(animationLibrary.some((animation) => animation.id === "bioluminescence"));
  assert.ok(animationLibrary.every((animation) => animation.palette.length >= 3));
});

test("animation media uses one stable recipe and bundle-relative contract", () => {
  assert.equal(animationMediaSchema, "motion-levels-animation-media-v1");
  assert.deepEqual(animationPreviewRecipe, {
    seed: 137,
    captureStartMillis: 800,
    frameCount: 24,
    frameIntervalMillis: 100,
    stillFrameIndex: 4,
    pressure: { x: 8, y: 16, startedAtMillis: 1_200 }
  });
  assert.deepEqual(animationMediaReferences(" Aurora "), {
    thumbnailSmall: "media/animations/aurora/aurora-thumbnail-small.webp",
    thumbnail: "media/animations/aurora/aurora-thumbnail.webp",
    animation: "media/animations/aurora/aurora-preview.webp"
  });
  assert.equal(
    animationMediaURL("aurora", "animation", "https://example.test/games/play/"),
    "https://example.test/games/media/animations/aurora/aurora-preview.webp"
  );
  assert.deepEqual(animationMediaCatalogEntry(findAnimation("aurora")).media, animationMediaReferences("aurora"));
  assert.throws(() => animationMediaReferences("../aurora"));
});

test("rendering is deterministic and always fills the hardware floor", () => {
  const animation = findAnimation("prism-tunnel");
  const first = renderAnimationFrame(animation, { atMillis: 4_321, seed: 99 });
  const second = renderAnimationFrame(animation, { atMillis: 4_321, seed: 99 });
  assert.deepEqual(first, second);
  assert.equal(first.cells.length, 16 * 32);
  assert.ok(first.cells.every((cell) => /^#[0-9a-f]{6}$/u.test(cell.color)));
});

test("every catalog preview changes visibly during its encoded timeline", () => {
  for (const animation of animationLibrary) {
    const options = {
      seed: animationPreviewRecipe.seed,
      pressure: [animationPreviewRecipe.pressure]
    };
    assert.notDeepEqual(
      renderAnimationFrame(animation, { ...options, atMillis: animationPreviewRecipe.captureStartMillis }),
      renderAnimationFrame(animation, {
        ...options,
        atMillis: animationPreviewRecipe.captureStartMillis + animationPreviewRecipe.frameIntervalMillis * 8
      }),
      `${animation.id} preview should move`
    );
  }
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
