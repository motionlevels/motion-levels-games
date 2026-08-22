import assert from "node:assert/strict";
import test from "node:test";
import { playgroundMediaOptionsFor } from "../src/mediaOptions.ts";

const selection = {
  gameId: "ping-pong-v2",
  difficulty: "medium" as const,
  playerCount: 2,
  seed: 137,
  options: { points_to_win: 5 }
};

test("non-selected games retain their authored preview scenario", () => {
  assert.deepEqual(playgroundMediaOptionsFor("duelo", selection), {});
  assert.deepEqual(playgroundMediaOptionsFor("duelo", selection, { difficulty: "hard" }), {
    difficulty: "hard"
  });
});

test("the selected game uses its live configuration unless explicitly overridden", () => {
  assert.deepEqual(playgroundMediaOptionsFor("ping-pong-v2", selection), {
    difficulty: "medium",
    playerCount: 2,
    seed: 137,
    options: { points_to_win: 5 }
  });
  assert.deepEqual(playgroundMediaOptionsFor("ping-pong-v2", selection, {
    playerCount: 0,
    seed: 202,
    options: { points_to_win: 9 }
  }), {
    difficulty: "medium",
    playerCount: 0,
    seed: 202,
    options: { points_to_win: 9 }
  });
});
