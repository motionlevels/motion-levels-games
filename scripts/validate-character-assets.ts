import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  inspectGlb,
  minimumAnimationLibrary,
  characterAssetManifests,
  quaterniusAssetManifests,
  sahurAssetManifest,
  validateCharacterAsset,
  type CharacterAssetManifest
} from "../packages/character-runtime/src/index.ts";
import {
  auditCharacterAsset,
  defaultAuditPolicyFor,
  inspectCharacterGlb,
  quaterniusInterimAuditPolicy,
  sahurInterimAuditPolicy,
  type CharacterAssetAuditPolicy
} from "./lib/character-asset-audit.ts";

const manifests: readonly CharacterAssetManifest[] = characterAssetManifests;
const policies: Readonly<Record<string, CharacterAssetAuditPolicy>> = Object.freeze({
  [sahurAssetManifest.id]: sahurInterimAuditPolicy,
  ...Object.fromEntries(quaterniusAssetManifests.map((manifest) => [manifest.id, quaterniusInterimAuditPolicy]))
});
const failures: string[] = [];

async function resolveAssetPath(file: string): Promise<string> {
  const submodulePath = path.resolve("assets/3d/characters", path.basename(file));
  try {
    const s = await stat(submodulePath);
    if (s.isFile()) return submodulePath;
  } catch {
    // fallback
  }
  return path.resolve("packages/character-runtime", file);
}

for (const manifest of manifests) {
  const absolutePath = await resolveAssetPath(manifest.file);
  const bytes = await readFile(absolutePath);
  const inspection = inspectGlb(bytes);
  const validation = validateCharacterAsset(manifest, inspection);
  const auditInspection = inspectCharacterGlb(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (manifest.sha256 && manifest.sha256 !== sha256) validation.errors.push("sha256-mismatch");
  if (manifest.attributionRequired && (!manifest.author || !manifest.license || !manifest.source)) {
    validation.errors.push("missing-attribution-metadata");
  }
  const audit = auditCharacterAsset(
    manifest,
    validation,
    auditInspection,
    minimumAnimationLibrary.map((clip) => clip.name),
    policies[manifest.id] ?? defaultAuditPolicyFor(manifest)
  );
  if (audit.errors.length > 0) {
    failures.push(`${manifest.id}: ${audit.errors.join(", ")}`);
  }
  console.log(JSON.stringify({
    id: manifest.id,
    status: manifest.status,
    sha256,
    inspection,
    processedTextures: auditInspection.textures,
    textureImageIndices: auditInspection.textureImageIndices,
    sceneRoots: auditInspection.hierarchy.sceneRoots,
    nonUnitScaleNodes: auditInspection.nonUnitScaleNodes,
    nonIdentitySceneRoots: auditInspection.nonIdentitySceneRoots,
    hierarchy: auditInspection.hierarchy,
    canonicalCoverage: audit.canonicalCoverage,
    valid: audit.errors.length === 0,
    errors: audit.errors,
    warnings: audit.warnings
  }));
}

if (failures.length > 0) {
  throw new Error(`Character asset validation failed\n${failures.join("\n")}`);
}
