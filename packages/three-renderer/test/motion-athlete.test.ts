import assert from "node:assert/strict";
import test from "node:test";
import { SkinnedMesh } from "three";
import {
  canonicalRig,
  createAnimationGraphState,
  motionAthleteCast,
  type AnimationGraphState,
  type AnimationParameters,
  type ProceduralPose
} from "@motion-levels-games/character-runtime";
import {
  MotionAthlete,
  MotionAthleteGeometryPool,
  createCanonicalRigNodes
} from "../src/index.ts";

test("all four Motion Athlete variants have exact canonical rig parity", () => {
  const resources = new MotionAthleteGeometryPool();
  const athletes = motionAthleteCast.map((variant) => new MotionAthlete(variant.id, resources));
  for (const athlete of athletes) {
    assert.deepEqual(Object.keys(athlete.bones), canonicalRig.bones);
    assert.equal(athlete.variant.rigId, canonicalRig.id);
    assert.equal(athlete.bones.hips.parent, athlete.bones.root);
    assert.equal(athlete.bones.head.parent, athlete.bones.neck);
    assert.equal(athlete.bones.hand_l.parent, athlete.bones.lower_arm_l);
    assert.equal(athlete.bones.toe_r.parent, athlete.bones.foot_r);
    const skinnedBodies: SkinnedMesh[] = [];
    athlete.object.traverse((object) => {
      if (object instanceof SkinnedMesh) skinnedBodies.push(object);
    });
    assert.equal(skinnedBodies.length, 1, "each high-detail athlete is one skinned body draw");
    assert.equal(skinnedBodies[0]?.skeleton.bones.length, canonicalRig.bones.length);
    assert.ok(skinnedBodies[0]?.geometry.getAttribute("color"));
    assert.ok(skinnedBodies[0]?.geometry.getAttribute("skinIndex"));
    assert.ok(skinnedBodies[0]?.geometry.getAttribute("athleteBlink"));
    assert.ok(skinnedBodies[0]?.geometry.getAttribute("athleteBlinkCenter"));
    const bounds = skinnedBodies[0]?.geometry.boundingBox;
    assert.ok(bounds && bounds.max.y > 1.5 && bounds.min.y < 0, "merged vertices stay in canonical mesh bind space");
    assert.ok(bounds && bounds.max.x - bounds.min.x > 1.4, "merged silhouette spans both hands");
  }
  assert.equal(new Set(athletes.map((athlete) => athlete.variant.id)).size, 4);
  for (const athlete of athletes) athlete.dispose();
  resources.dispose();
});

test("canonical rig creation is structural and LOD preserves the rig", () => {
  const rig = createCanonicalRigNodes();
  assert.deepEqual(Object.keys(rig.bones), canonicalRig.bones);
  const resources = new MotionAthleteGeometryPool();
  const athlete = new MotionAthlete("guardian", resources);
  assert.equal(visibleMeshes(athlete), 1);
  athlete.setLod("medium");
  assert.equal(athlete.object.visible, true);
  assert.equal(visibleMeshes(athlete), 1);
  assert.deepEqual(Object.keys(athlete.bones), canonicalRig.bones);
  athlete.setLod("hidden");
  assert.equal(athlete.object.visible, false);
  athlete.setLod("low");
  assert.equal(athlete.object.visible, true);
  assert.equal(visibleMeshes(athlete), 1);
  athlete.dispose();
  resources.dispose();
});

test("pose blending consumes outgoing and incoming samples on every animation channel", () => {
  const resources = new MotionAthleteGeometryPool();
  const athlete = new MotionAthlete("runner", resources);
  const idle = createAnimationGraphState();

  athlete.applyPose({
    ...idle,
    locomotion: {
      clip: "idle-neutral",
      previousClip: "walk",
      blend: 0.5,
      currentWeight: 0.5,
      previousWeight: 0.5,
      elapsedMillis: 0,
      previousElapsedMillis: 225
    }
  }, neutralPose, neutralParameters, 0);
  assert.ok(Math.abs(athlete.bones.upper_leg_l.rotation.x - 0.26) < 1e-9);

  athlete.applyPose({
    ...idle,
    fullBody: transition("collect", "celebrate-large", 0.75, 0.25)
  }, neutralPose, neutralParameters, 0);
  assert.ok(Math.abs(athlete.bones.upper_arm_l.rotation.z - -0.9) < 1e-9);

  athlete.applyPose({
    ...idle,
    upperBody: transition("point", "wave", 0.75, 0.25)
  }, neutralPose, neutralParameters, 0);
  assert.ok(Math.abs(athlete.bones.upper_arm_r.rotation.z - -0.65) < 1e-9);

  athlete.dispose();
  resources.dispose();
});

const neutralParameters: AnimationParameters = {
  velocity: { x: 1, y: 0 },
  acceleration: { x: 0, y: 0 },
  angularVelocity: 0,
  grounded: true,
  action: "none",
  intention: "idle",
  emotion: "neutral",
  timeSinceMovementBeganMillis: 0,
  timeSinceMovementEndedMillis: 0
};

const neutralPose: ProceduralPose = {
  headYawRadians: 0,
  headPitchRadians: 0,
  bodyLeanX: 0,
  bodyLeanY: 0,
  blink: 0,
  pointWeight: 0,
  lookOverShoulderWeight: 0,
  startleWeight: 0,
  breathingWeight: 0,
  emotionWeight: 0
};

function transition(
  clip: AnimationGraphState["locomotion"]["clip"],
  previousClip: AnimationGraphState["locomotion"]["clip"],
  currentWeight: number,
  previousWeight: number
): AnimationGraphState["locomotion"] {
  return {
    clip,
    previousClip,
    blend: currentWeight,
    currentWeight,
    previousWeight,
    elapsedMillis: 0,
    previousElapsedMillis: 100
  };
}

function visibleMeshes(athlete: MotionAthlete): number {
  let count = 0;
  athlete.object.traverse((object) => {
    if (object.visible && (object as MeshLike).isMesh) count += 1;
  });
  return count;
}

type MeshLike = { isMesh?: boolean };
