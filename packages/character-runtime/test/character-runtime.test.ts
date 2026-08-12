import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CANONICAL_RIG_ID,
  CharacterPerformanceMonitor,
  advanceAnimationGraph,
  animationBlendWeights,
  canonicalRig,
  characterQualityProfiles,
  createAnimationGraphState,
  gridToWorld,
  inspectGlb,
  interpolateAgentSnapshot,
  minimumAnimationLibrary,
  motionAthleteCast,
  proceduralPose,
  quaterniusAnimationClips,
  quaterniusAssetManifests,
  quaterniusCharacterAssets,
  sahurAssetManifest,
  validateCharacterAsset,
  type AnimationClipName,
  type AnimationParameters,
  type RenderableAgentSnapshot
} from "../src/index.ts";

const still: AnimationParameters = {
  velocity: { x: 0, y: 0 },
  acceleration: { x: 0, y: 0 },
  angularVelocity: 0,
  grounded: true,
  action: "none",
  intention: "wait",
  emotion: "neutral",
  timeSinceMovementBeganMillis: 0,
  timeSinceMovementEndedMillis: 2_000
};

test("the four visual identities share one canonical rig", () => {
  assert.equal(canonicalRig.bones.length, 20);
  assert.equal(new Set(motionAthleteCast.map((variant) => variant.id)).size, 4);
  assert.deepEqual(new Set(motionAthleteCast.map((variant) => variant.rigId)), new Set([CANONICAL_RIG_ID]));
  assert.equal(minimumAnimationLibrary.length, 29);
  assert.equal(new Set(minimumAnimationLibrary.map((clip) => clip.name)).size, minimumAnimationLibrary.length);
});

test("every declared animation state has explicit deterministic input semantics", () => {
  const cases: readonly Readonly<{
    clip: AnimationClipName;
    layer: "locomotion" | "full-body" | "upper-body";
    parameters: AnimationParameters;
  }>[] = [
    animationCase("idle-neutral", "locomotion", {}),
    animationCase("idle-alert", "locomotion", { intention: "reach-objective" }),
    animationCase("walk", "locomotion", { velocity: { x: 0, y: 1.2 } }),
    animationCase("run", "locomotion", { velocity: { x: 0, y: 3 } }),
    animationCase("strafe-left", "locomotion", {
      velocity: { x: 0, y: 1.2 },
      targetDirection: { x: -1, y: 0 }
    }),
    animationCase("strafe-right", "locomotion", {
      velocity: { x: 0, y: 1.2 },
      targetDirection: { x: 1, y: 0 }
    }),
    animationCase("turn-left", "locomotion", { angularVelocity: -1 }),
    animationCase("turn-right", "locomotion", { angularVelocity: 1 }),
    animationCase("pivot", "locomotion", {
      velocity: { x: 0, y: 1 },
      acceleration: { x: 5, y: 0 }
    }),
    animationCase("stop-recover", "locomotion", { timeSinceMovementEndedMillis: 100 }),
    animationCase("jump-anticipation", "full-body", { action: "jump" }),
    animationCase("jump-airborne", "full-body", { action: "airborne" }),
    animationCase("land-light", "full-body", { action: "land-light" }),
    animationCase("land-heavy", "full-body", { action: "land-heavy" }),
    animationCase("dodge", "full-body", { action: "dodge" }),
    animationCase("collect", "full-body", { action: "collect" }),
    animationCase("interact", "upper-body", { action: "interact" }),
    animationCase("hit", "full-body", { action: "hit" }),
    animationCase("fall", "full-body", { action: "fall" }),
    animationCase("revive", "full-body", { action: "revive" }),
    animationCase("point", "upper-body", { socialGesture: "point" }),
    animationCase("wave", "upper-body", { socialGesture: "wave" }),
    animationCase("celebrate-small", "upper-body", { action: "celebrate-small" }),
    animationCase("celebrate-large", "full-body", { action: "celebrate-large" }),
    animationCase("celebrate-team", "full-body", { action: "celebrate-team" }),
    animationCase("disappointment", "upper-body", { recentEvent: "failure" }),
    animationCase("fear", "upper-body", { recentEvent: "near-miss" }),
    animationCase("confused", "upper-body", { recentEvent: "blocked" }),
    animationCase("taunt", "upper-body", { socialGesture: "taunt" })
  ];

  for (const candidate of cases) {
    const state = advanceAnimationGraph(createAnimationGraphState(), candidate.parameters, 16);
    const selected = candidate.layer === "locomotion"
      ? state.locomotion.clip
      : candidate.layer === "full-body"
        ? state.fullBody?.clip
        : state.upperBody?.clip;
    assert.equal(selected, candidate.clip, `${candidate.clip} must be reachable through ${candidate.layer}`);
  }
  assert.deepEqual(
    [...new Set(cases.map((candidate) => candidate.clip))].sort(),
    minimumAnimationLibrary.map((definition) => definition.name).sort()
  );
});

test("animation graph blends locomotion and obeys full-body interruption priorities", () => {
  let state = advanceAnimationGraph(createAnimationGraphState(), {
    ...still,
    velocity: { x: 0, y: 1.2 },
    intention: "reach-objective"
  }, 70);
  assert.equal(state.locomotion.clip, "walk");
  assert.deepEqual(animationBlendWeights(state.locomotion), { "idle-neutral": 0.5, walk: 0.5 });
  assert.equal(state.locomotion.previousElapsedMillis, 70);

  state = advanceAnimationGraph(state, {
    ...still,
    velocity: { x: 0, y: 1.2 },
    intention: "reach-objective"
  }, 35);
  assert.deepEqual(animationBlendWeights(state.locomotion), { "idle-neutral": 0.25, walk: 0.75 });
  assert.equal(state.locomotion.previousElapsedMillis, 105);

  state = advanceAnimationGraph(state, { ...still, action: "hit" }, 20);
  assert.equal(state.fullBody?.clip, "hit");
  assert.ok(Math.abs((state.fullBody?.currentWeight ?? 0) - 20 / 90) < 1e-12);
  state = advanceAnimationGraph(state, { ...still, action: "collect" }, 100);
  assert.equal(state.fullBody?.clip, "hit", "a lower-priority collect cannot interrupt hit recovery");
  state = advanceAnimationGraph(state, { ...still, action: "fall" }, 20);
  assert.equal(state.fullBody?.clip, "fall");
  assert.ok((state.fullBody?.previousWeight ?? 0) > 0);
  assert.ok((state.fullBody?.currentWeight ?? 0) > 0);
  assert.ok(Math.abs(Object.values(animationBlendWeights(state.fullBody!)).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  assert.equal(state.playbackRate, 1);

  state = advanceAnimationGraph(state, still, 880);
  assert.equal(state.fullBody?.clip, "fall", "a one-shot remains until its authored duration completes");
  state = advanceAnimationGraph(state, still, 45);
  assert.equal(state.fullBody?.fadingOut, true);
  assert.equal(state.fullBody?.currentWeight, 0.5);
  state = advanceAnimationGraph(state, still, 45);
  assert.equal(state.fullBody, undefined);
});

test("procedural signalling exposes intention before movement", () => {
  const pose = proceduralPose({
    ...still,
    intention: "collect",
    targetDirection: { x: 1, y: 0 },
    recentEvent: "objective-selected",
    emotion: "afraid",
    velocity: { x: 0.5, y: 0 }
  }, 10, 137);
  assert.equal(pose.pointWeight, 1);
  assert.equal(pose.lookOverShoulderWeight, 1);
  assert.equal(pose.headYawRadians, 0.75);
  assert.equal(pose.emotionWeight, 1);
});

test("snapshots interpolate logical state without crossing the long angle arc", () => {
  const previous = { ...snapshot("agent", 0, 1, 2, Math.PI - 0.1), targetId: "old-target" };
  const next = { ...snapshot("agent", 1, 3, 4, -Math.PI + 0.1), targetId: "new-target" };
  const halfway = interpolateAgentSnapshot(previous, next, 0.5);
  assert.deepEqual(halfway.position, { x: 2, y: 3 });
  assert.ok(Math.abs(Math.abs(halfway.facingRadians) - Math.PI) < 0.01);
  assert.equal(interpolateAgentSnapshot(previous, next, 0).targetId, "old-target");
  assert.equal(interpolateAgentSnapshot(previous, next, 0.49).targetId, "old-target");
  assert.equal(halfway.targetId, "new-target");
  assert.deepEqual(gridToWorld({ x: 0, y: 0 }), { x: -1.875, y: 0, z: -3.875 });
  assert.deepEqual(gridToWorld({ x: 15, y: 31 }), { x: 1.875, y: 0, z: 3.875 });
  assert.throws(() => interpolateAgentSnapshot(previous, snapshot("other", 1, 0, 0, 0), 0.5), /different agents/);
});

test("quality profiles are explicit and instrumentation reports budget violations", () => {
  const profile = characterQualityProfiles["desktop-medium"];
  assert.equal(profile.fixedSceneDrawCallAllowance, 6);
  assert.equal(characterQualityProfiles["mobile-low"].shadows, "none");
  const monitor = new CharacterPerformanceMonitor(profile);
  monitor.record({
    frameMillis: 16,
    animationMillis: 2,
    drawCalls: 20,
    triangles: 200_000,
    textureMegabytes: 4,
    characters: 10
  });
  assert.equal(monitor.report().withinBudget, true);
  monitor.record({
    frameMillis: 42,
    animationMillis: 7,
    drawCalls: 50,
    triangles: 500_000,
    textureMegabytes: 9,
    characters: 11
  });
  const report = monitor.report();
  assert.equal(report.withinBudget, false);
  assert.deepEqual(report.violations, ["frame-time", "character-count", "draw-calls", "triangles", "texture-memory"]);

  const bounded = new CharacterPerformanceMonitor(profile, 1);
  bounded.record({ frameMillis: 99, animationMillis: 1, drawCalls: 1, triangles: 1, textureMegabytes: 0, characters: 1 });
  bounded.record({ frameMillis: 10, animationMillis: 1, drawCalls: 1, triangles: 1, textureMegabytes: 0, characters: 1 });
  assert.equal(bounded.report().samples, 1);
  assert.equal(bounded.report().worstFrameMillis, 10);
  assert.throws(() => new CharacterPerformanceMonitor(profile, 0), /capacity/);

  const sceneAllowance = new CharacterPerformanceMonitor(profile);
  sceneAllowance.record({
    frameMillis: 10,
    animationMillis: 1,
    drawCalls: profile.maxDrawCallsPerCharacter + profile.fixedSceneDrawCallAllowance,
    triangles: 1,
    textureMegabytes: 0,
    characters: 1
  });
  assert.equal(sceneAllowance.report().withinBudget, true);
  sceneAllowance.record({
    frameMillis: 10,
    animationMillis: 1,
    drawCalls: profile.maxDrawCallsPerCharacter + profile.fixedSceneDrawCallAllowance + 1,
    triangles: 1,
    textureMegabytes: 0,
    characters: 1
  });
  assert.ok(sceneAllowance.report().violations.includes("draw-calls"));

  const mixedCharacterCounts = new CharacterPerformanceMonitor(profile);
  mixedCharacterCounts.record({
    frameMillis: 10,
    animationMillis: 1,
    drawCalls: 1,
    triangles: 1,
    textureMegabytes: 0,
    characters: 10
  });
  mixedCharacterCounts.record({
    frameMillis: 10,
    animationMillis: 1,
    drawCalls: profile.maxDrawCallsPerCharacter + profile.fixedSceneDrawCallAllowance + 1,
    triangles: 1,
    textureMegabytes: 0,
    characters: 1
  });
  assert.ok(mixedCharacterCounts.report().violations.includes("draw-calls"));

  const emptyScene = new CharacterPerformanceMonitor(profile);
  emptyScene.record({
    frameMillis: 10,
    animationMillis: 1,
    drawCalls: profile.fixedSceneDrawCallAllowance,
    triangles: 1,
    textureMegabytes: 0,
    characters: 0
  });
  assert.equal(emptyScene.report().withinBudget, true);
});

test("the included Sahur GLB passes its audited interim budgets and licence metadata", async () => {
  const bytes = await readFile(new URL("../assets/tung-tung-tung-sahur.glb", import.meta.url));
  const inspection = inspectGlb(bytes);
  assert.equal(inspection.bytes, 269_968);
  assert.deepEqual(inspection.animations, ["Armature|walk"]);
  assert.ok(inspection.bones.length > 20);
  assert.ok(inspection.triangles > 1_000 && inspection.triangles < 2_000);
  const validation = validateCharacterAsset(sahurAssetManifest, inspection);
  assert.equal(validation.valid, true, validation.errors.join(", "));
  assert.match(validation.warnings.join("\n"), /asset-status:interim/);
  assert.match(validation.warnings.join("\n"), /attribution-required:KAG3D/);
});

test("all ten Quaternius characters retain their shared rig and 24 authored clips", async () => {
  assert.equal(quaterniusCharacterAssets.length, 10);
  assert.equal(quaterniusAssetManifests.length, 10);
  for (const [index, asset] of quaterniusCharacterAssets.entries()) {
    const manifest = quaterniusAssetManifests[index]!;
    const bytes = await readFile(new URL(`../assets/${asset.fileName}`, import.meta.url));
    const inspection = inspectGlb(bytes);
    assert.equal(bytes.byteLength, asset.bytes, asset.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.id);
    assert.deepEqual(inspection.animations, quaterniusAnimationClips, asset.id);
    assert.ok(inspection.skins >= 1, asset.id);
    assert.ok(inspection.bones.length >= 60, asset.id);
    assert.ok(inspection.triangles <= asset.maxTriangles, asset.id);
    const validation = validateCharacterAsset(manifest, inspection);
    assert.equal(validation.valid, true, `${asset.id}: ${validation.errors.join(", ")}`);
  }
});

test("GLB inspector fails closed for corrupt files", () => {
  assert.throws(() => inspectGlb(new Uint8Array(12)), /too short/);
  const bytes = new Uint8Array(20);
  assert.throws(() => inspectGlb(bytes), /magic/);
});

function snapshot(id: string, tick: number, x: number, y: number, facingRadians: number): RenderableAgentSnapshot {
  return {
    id,
    tick,
    position: { x, y },
    velocity: { x: 1, y: 0 },
    facingRadians,
    grounded: true,
    action: "move",
    intention: "objective",
    emotion: "neutral"
  };
}

function animationCase(
  clip: AnimationClipName,
  layer: "locomotion" | "full-body" | "upper-body",
  parameters: Partial<AnimationParameters>
): Readonly<{ clip: AnimationClipName; layer: "locomotion" | "full-body" | "upper-body"; parameters: AnimationParameters }> {
  return { clip, layer, parameters: { ...still, ...parameters } };
}
