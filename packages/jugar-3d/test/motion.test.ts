import assert from "node:assert/strict";
import test from "node:test";

import { createAvatar, setAvatarTarget, updateAvatar } from "../src/core/avatar.ts";
import { deterministicLocomotionPose } from "../src/characters/motion.ts";

test("recorded presentation time samples locomotion without render-history drift", () => {
  const avatar = createAvatar(3, 2, true, "#ffffff", { x: 2, y: 3 }, 4.8);
  setAvatarTarget(avatar, { x: 9, y: 12 });
  for (let atMillis = 20; atMillis <= 340; atMillis += 20) {
    updateAvatar(avatar, atMillis, 20);
  }

  const first = deterministicLocomotionPose(avatar, 340);
  const afterUnrelatedSamples = [100, 1_200, 9_999]
    .map((atMillis) => deterministicLocomotionPose(avatar, atMillis));
  const repeated = deterministicLocomotionPose(avatar, 340);

  assert.deepEqual(repeated, first);
  assert.equal(first.time, 0.34);
  assert.equal(first.moving, true);
  assert.ok(first.speed > 2 && first.speed <= 2.4);
  assert.equal(afterUnrelatedSamples.length, 3);

  const idle = createAvatar(4, 3, true, "#ffffff", { x: 2, y: 3 }, 4.8);
  assert.deepEqual(deterministicLocomotionPose(idle, 2_340), {
    time: 2.34,
    moving: false,
    speed: 0,
    motion: 0,
    stride: 0,
    counterStride: 0
  });
});

test("authority accelerates and turns without changing deterministic tile semantics", () => {
  const avatar = createAvatar(0, 0, false, "#ffffff", { x: 2, y: 3 }, 6.4);
  setAvatarTarget(avatar, { x: 2, y: 12 });
  updateAvatar(avatar, 20, 20);
  const startingSpeed = Math.hypot(avatar.velocity.x, avatar.velocity.y);
  const startingFacing = avatar.facingRadians;
  assert.ok(startingSpeed > 0 && startingSpeed < avatar.speed);

  for (let atMillis = 40; atMillis <= 240; atMillis += 20) updateAvatar(avatar, atMillis, 20);
  assert.ok(Math.hypot(avatar.velocity.x, avatar.velocity.y) > startingSpeed);
  assert.ok(avatar.distanceTravelled > 0);

  setAvatarTarget(avatar, { x: 12, y: 4 });
  updateAvatar(avatar, 260, 20);
  assert.ok(Math.abs(avatar.facingRadians - startingFacing) <= 8.5 * 0.26 + 1e-9);
  assert.equal(Number.isInteger(avatar.tile.x), true);
  assert.equal(Number.isInteger(avatar.tile.y), true);
});
