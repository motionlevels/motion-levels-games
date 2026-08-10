import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectGlb,
  minimumAnimationLibrary,
  sahurAssetManifest,
  validateCharacterAsset,
  type CharacterAssetManifest
} from "../packages/character-runtime/src/index.ts";
import {
  auditCharacterAsset,
  defaultAuditPolicyFor,
  inspectCharacterGlb,
  sahurInterimAuditPolicy,
  type CharacterAssetAuditPolicy
} from "./lib/character-asset-audit.ts";

const manifests: readonly CharacterAssetManifest[] = [sahurAssetManifest];
const policies: Readonly<Record<string, CharacterAssetAuditPolicy>> = Object.freeze({
  [sahurAssetManifest.id]: sahurInterimAuditPolicy
});
const failures: string[] = [];

for (const manifest of manifests) {
  const absolutePath = path.resolve("packages/character-runtime", manifest.file);
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
