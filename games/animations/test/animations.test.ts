import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { animationLibrary } from "@motion-levels-games/animation-runtime";
import { PlayerDisplay } from "../src/display.tsx";
import { animationContentSchema, createGame } from "../src/game.ts";

test("ambient animation starts immediately and responds to pressure", () => {
  const game = createGame({ seed: 44, options: { animation: "neon-ribbons", mode: "single", speed: 1, rotationSeconds: 20 } });
  game.init(0);
  assert.equal(game.snapshot().phase, "running");
  assert.equal(game.snapshot().animationId, "neon-ribbons");
  assert.equal(game.snapshot().rotationActive, false);
  assert.equal(game.snapshot().rotationRemainingMillis, 0);
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
  assert.equal(game.snapshot().rotationActive, true);
  assert.equal(game.snapshot().rotationRemainingMillis, 5_000);
  game.tick({ atMillis: 1_250 });
  assert.equal(game.snapshot().animationId, "aurora");
  assert.equal(game.snapshot().rotationRemainingMillis, 3_750);
  game.tick({ atMillis: 4_999 });
  assert.equal(game.snapshot().animationId, "aurora");
  assert.equal(game.snapshot().rotationRemainingMillis, 1);
  game.tick({ atMillis: 5_000 });
  assert.equal(game.snapshot().animationId, "prism-tunnel");
  assert.equal(game.snapshot().contentRevision, "sha256:fixture");
  assert.equal(game.snapshot().rotationRemainingMillis, 5_000);
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
  assert.equal(game.snapshot().rotationActive, false);
  assert.equal(game.snapshot().rotationRemainingMillis, 0);
  assert.equal(game.snapshot().rotationSize, 1);
});

test("player display shows Motion Levels, the 16x32 floor, and a contextual countdown", () => {
  const game = createGame({
    options: { animation: "aurora", mode: "rotation", speed: 1, rotationSeconds: 20 },
    content: {
      schema: animationContentSchema,
      contentRevision: "sha256:display",
      rotationIds: ["aurora", "prism-tunnel"],
      rotationSeconds: 5
    }
  });
  game.init(0);
  game.tick({ atMillis: 1_250 });

  const html = renderToStaticMarkup(React.createElement(PlayerDisplay, {
    snapshot: game.snapshot(),
    frame: game.render()
  }));

  assert.match(html, /ml-tv-brand-mark/);
  assert.match(html, />Motion</);
  assert.match(html, />Levels</);
  assert.match(html, /Suelo 16 × 32/);
  assert.match(html, /ml-floor-preview/);
  assert.match(html, /aria-colcount="16"/);
  assert.match(html, /aria-rowcount="32"/);
  assert.equal(html.match(/class="ml-floor-tile/g)?.length, 512);
  assert.match(html, /Cambio en/);
  assert.match(html, />0:04</);
  assert.match(html, /Siguiente animación/);
  assert.doesNotMatch(html, />01</);
});

test("every library entry can be selected and rendered", () => {
  for (const animation of animationLibrary) {
    const game = createGame({ options: { animation: animation.id, mode: "single", speed: 1, rotationSeconds: 20 } });
    game.init(0);
    assert.equal(game.snapshot().animationId, animation.id);
    assert.equal(game.render().cells.length, 512);
  }
});
