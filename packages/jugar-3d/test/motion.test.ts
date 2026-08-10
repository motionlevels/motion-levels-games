import assert from "node:assert/strict";
import test from "node:test";

import { createAvatar, setAvatarTarget } from "../src/core/avatar.ts";
import { deterministicLocomotionPose } from "../src/characters/motion.ts";

test("recorded presentation time samples locomotion without render-history drift", () => {
  const avatar = createAvatar(3, 2, true, "#ffffff", { x: 2, y: 3 }, 4.8);
  setAvatarTarget(avatar, { x: 9, y: 12 });

  const first = deterministicLocomotionPose(avatar, 2_340);
  const afterUnrelatedSamples = [100, 1_200, 9_999]
    .map((atMillis) => deterministicLocomotionPose(avatar, atMillis));
  const repeated = deterministicLocomotionPose(avatar, 2_340);

  assert.deepEqual(repeated, first);
  assert.equal(first.time, 2.34);
  assert.equal(first.moving, true);
  assert.equal(first.speed, 4.8);
  assert.equal(afterUnrelatedSamples.length, 3);

  avatar.target = null;
  assert.deepEqual(deterministicLocomotionPose(avatar, 2_340), {
    time: 2.34,
    moving: false,
    speed: 0,
    motion: 0,
    stride: 0,
    counterStride: 0
  });
});
