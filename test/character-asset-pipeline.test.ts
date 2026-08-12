import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  minimumAnimationLibrary,
  quaterniusAssetManifests,
  sahurAssetManifest,
  validateCharacterAsset,
  inspectGlb,
  type CharacterAssetManifest
} from "../packages/character-runtime/src/index.ts";
import {
  auditCharacterAsset,
  defaultAuditPolicyFor,
  inspectCharacterGlb,
  quaterniusInterimAuditPolicy,
  sahurInterimAuditPolicy
} from "../scripts/lib/character-asset-audit.ts";
import {
  PINNED_GLTF_TRANSFORM_CLI_VERSION,
  PINNED_SHARP_VERSION,
  buildCharacterOptimizationStages,
  parseCharacterOptimizationArgs
} from "../scripts/lib/character-asset-optimizer.ts";

const canonicalClips = minimumAnimationLibrary.map((clip) => clip.name);

test("the processed Sahur GLB has inspectable 512px embedded WebP textures and a sound skin hierarchy", async () => {
  const bytes = await readFile(new URL(
    "../packages/character-runtime/assets/tung-tung-tung-sahur.glb",
    import.meta.url
  ));
  const inspection = inspectCharacterGlb(bytes);
  assert.deepEqual(
    inspection.textures.map((texture) => [texture.mimeType, texture.width, texture.height, texture.embedded]),
    Array.from({ length: 3 }, () => ["image/webp", 512, 512, true])
  );
  assert.ok(inspection.textures.every((texture) => (
    texture.declaredMimeType === "image/webp" && texture.detectedMimeType === "image/webp"
  )));
  assert.deepEqual(inspection.textureImageIndices, [0, 2, 1]);
  assert.deepEqual(inspection.hierarchy.invalidChildReferences, []);
  assert.deepEqual(inspection.hierarchy.multipleParentNodes, []);
  assert.deepEqual(inspection.hierarchy.cycles, []);
  assert.deepEqual(inspection.hierarchy.skins[0]?.unreachableJoints, []);

  const audit = auditCharacterAsset(
    sahurAssetManifest,
    validateCharacterAsset(sahurAssetManifest, inspectGlb(bytes)),
    inspection,
    canonicalClips,
    sahurInterimAuditPolicy
  );
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.canonicalCoverage.covered, 0);
  assert.match(audit.warnings.join("\n"), /interim-canonical-animation-coverage:0\/29/);
  assert.match(audit.warnings.join("\n"), /interim-non-unit-scale/);
});

test("canonical assets fail explicitly when animation, texture, scale, or hierarchy contracts drift", async () => {
  const bytes = await readFile(new URL(
    "../packages/character-runtime/assets/tung-tung-tung-sahur.glb",
    import.meta.url
  ));
  const inspection = inspectCharacterGlb(bytes);
  const manifest: CharacterAssetManifest = {
    ...sahurAssetManifest,
    id: "canonical-fixture",
    status: "canonical",
    expectedClips: canonicalClips,
    attributionRequired: false
  };
  const brokenInspection = {
    ...inspection,
    textures: inspection.textures.map((texture, index) => index === 0
      ? { ...texture, mimeType: "image/png", width: 2_048 }
      : texture),
    hierarchy: {
      ...inspection.hierarchy,
      multipleParentNodes: ["Head<-Spine,Neck"]
    }
  };
  const audit = auditCharacterAsset(
    manifest,
    { valid: true, errors: [], warnings: [] },
    brokenInspection,
    canonicalClips,
    defaultAuditPolicyFor(manifest)
  );
  const failures = audit.errors.join("\n");
  assert.match(failures, /canonical-animation-coverage:0\/29:missing=/);
  assert.match(failures, /processed-texture-format:image-0:image\/png/);
  assert.match(failures, /processed-texture-dimensions:image-0:2048x512/);
  assert.match(failures, /hierarchy-multiple-parent:Head<-Spine,Neck/);
  assert.match(failures, /canonical-non-unit-scale/);
  assert.match(failures, /canonical-non-identity-scene-root/);
});

test("palette-only Quaternius GLBs pass the documented CC0 interim policy", async () => {
  const manifest = quaterniusAssetManifests[0]!;
  const bytes = await readFile(new URL(
    `../packages/character-runtime/${manifest.file}`,
    import.meta.url
  ));
  const inspection = inspectCharacterGlb(bytes);
  assert.equal(inspection.textures.length, 0);
  assert.equal(inspection.animations.length, 24);
  const audit = auditCharacterAsset(
    manifest,
    validateCharacterAsset(manifest, inspectGlb(bytes)),
    inspection,
    canonicalClips,
    quaterniusInterimAuditPolicy
  );
  assert.deepEqual(audit.errors, []);
  assert.match(audit.warnings.join("\n"), /Quaternius rig supplies 24 named source clips/u);
});

test("the pinned optimizer refuses in-place writes and has an immutable three-stage plan", () => {
  assert.equal(PINNED_GLTF_TRANSFORM_CLI_VERSION, "4.4.2");
  assert.equal(PINNED_SHARP_VERSION, "0.35.3");
  assert.throws(() => parseCharacterOptimizationArgs([
    "--input", "asset.glb", "--output", "asset.glb"
  ]), /Refusing in-place/);
  const options = parseCharacterOptimizationArgs([
    "--input", "raw.glb",
    "--output", "processed.glb",
    "--expect-input-sha256", "a".repeat(64),
    "--dry-run"
  ]);
  assert.equal(options.expectedInputSha256, "a".repeat(64));
  assert.equal(options.dryRun, true);
  const stages = buildCharacterOptimizationStages(
    options.input,
    options.output,
    path.resolve("temporary-character-pipeline")
  );
  assert.deepEqual(stages.map((stage) => stage.name), ["metalrough", "resize", "webp"]);
  assert.deepEqual(
    stages[1]?.args.slice(-6),
    ["--width", "512", "--height", "512", "--filter", "lanczos3"]
  );
  assert.deepEqual(
    stages[2]?.args.slice(-6),
    ["--quality", "85", "--effort", "6", "--formats", "*"]
  );
  assert.equal(stages[0]?.input, options.input);
  assert.equal(stages[2]?.output, options.output);
});
