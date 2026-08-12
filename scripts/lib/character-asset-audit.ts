import type { CharacterAssetManifest, CharacterAssetValidation } from "../../packages/character-runtime/src/index.ts";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BINARY_CHUNK = 0x004e4942;
const identityTranslation = [0, 0, 0] as const;
const identityRotation = [0, 0, 0, 1] as const;
const identityScale = [1, 1, 1] as const;
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

export type CharacterTextureInspection = Readonly<{
  index: number;
  name: string;
  mimeType?: string;
  declaredMimeType?: string;
  detectedMimeType?: string;
  width?: number;
  height?: number;
  embedded: boolean;
  byteLength?: number;
  source: "buffer-view" | "data-uri" | "external-uri" | "missing";
}>;

export type CharacterNodeTransformInspection = Readonly<{
  index: number;
  name: string;
  translation: readonly number[];
  rotation: readonly number[];
  scale: readonly number[];
  matrix?: readonly number[];
  mesh: boolean;
  skin: boolean;
}>;

export type CharacterHierarchyInspection = Readonly<{
  sceneRoots: readonly number[];
  invalidChildReferences: readonly string[];
  multipleParentNodes: readonly string[];
  cycles: readonly string[];
  skins: readonly Readonly<{
    index: number;
    skeleton?: number;
    joints: readonly number[];
    invalidJoints: readonly number[];
    unreachableJoints: readonly number[];
  }>[];
}>;

export type CharacterGlbAuditInspection = Readonly<{
  generator?: string;
  extensionsUsed: readonly string[];
  assetExtras: Readonly<Record<string, unknown>>;
  animations: readonly string[];
  textures: readonly CharacterTextureInspection[];
  textureImageIndices: readonly number[];
  nodes: readonly CharacterNodeTransformInspection[];
  nonUnitScaleNodes: readonly string[];
  nonIdentitySceneRoots: readonly string[];
  hierarchy: CharacterHierarchyInspection;
}>;

export type CharacterAssetAuditPolicy = Readonly<{
  classification: CharacterAssetManifest["status"];
  processedTextureMimeTypes: readonly string[];
  maxTextureWidth: number;
  maxTextureHeight: number;
  requireEmbeddedTextures: boolean;
  requireTextures: boolean;
  requireAttributionExtras: boolean;
  requireUnitScale: boolean;
  requireIdentitySceneRoots: boolean;
  canonicalCoverageException?: Readonly<{
    reason: string;
  }>;
  scaleException?: Readonly<{
    reason: string;
  }>;
}>;

export type CharacterAssetAudit = Readonly<{
  errors: readonly string[];
  warnings: readonly string[];
  canonicalCoverage: Readonly<{
    covered: number;
    required: number;
    missing: readonly string[];
  }>;
}>;

type GltfJson = {
  asset?: { generator?: string; extras?: Record<string, unknown> };
  animations?: Array<{ name?: string }>;
  bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number }>;
  extensionsUsed?: string[];
  images?: Array<{ name?: string; mimeType?: string; bufferView?: number; uri?: string }>;
  nodes?: Array<{
    name?: string;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    mesh?: number;
    skin?: number;
  }>;
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  skins?: Array<{ skeleton?: number; joints?: number[] }>;
  textures?: Array<{
    source?: number;
    extensions?: {
      EXT_texture_webp?: { source?: number };
      KHR_texture_basisu?: { source?: number };
    };
  }>;
};

export const sahurInterimAuditPolicy: CharacterAssetAuditPolicy = Object.freeze({
  classification: "interim",
  processedTextureMimeTypes: Object.freeze(["image/webp"]),
  maxTextureWidth: 512,
  maxTextureHeight: 512,
  requireEmbeddedTextures: true,
  requireTextures: true,
  requireAttributionExtras: true,
  requireUnitScale: false,
  requireIdentitySceneRoots: false,
  canonicalCoverageException: Object.freeze({
    reason: "Credited Mixamo interim skin has one authored walk clip; the procedural Motion Athlete rig owns canonical coverage."
  }),
  scaleException: Object.freeze({
    reason: "Source FBX centimetre conversion remains in node transforms; runtime height scaling and floor seating are documented."
  })
});

export function defaultAuditPolicyFor(manifest: CharacterAssetManifest): CharacterAssetAuditPolicy {
  return Object.freeze({
    classification: manifest.status,
    processedTextureMimeTypes: Object.freeze(["image/webp", "image/ktx2"]),
    maxTextureWidth: 1_024,
    maxTextureHeight: 1_024,
    requireEmbeddedTextures: true,
    requireTextures: true,
    requireAttributionExtras: manifest.attributionRequired,
    requireUnitScale: manifest.status === "canonical",
    requireIdentitySceneRoots: manifest.status === "canonical"
  });
}

export const quaterniusInterimAuditPolicy: CharacterAssetAuditPolicy = Object.freeze({
  classification: "interim",
  processedTextureMimeTypes: Object.freeze([]),
  maxTextureWidth: 0,
  maxTextureHeight: 0,
  requireEmbeddedTextures: false,
  requireTextures: false,
  requireAttributionExtras: false,
  requireUnitScale: false,
  requireIdentitySceneRoots: false,
  canonicalCoverageException: Object.freeze({
    reason: "The Quaternius rig supplies 24 named source clips mapped by the Jugar adapter to Motion Levels animation states."
  }),
  scaleException: Object.freeze({
    reason: "Source rigs retain harmless exporter precision on upper-leg scale and intentional accessory-local scale; runtime height normalization seats the character."
  })
});

export function inspectCharacterGlb(bytes: Uint8Array): CharacterGlbAuditInspection {
  const { json, binary } = parseGlb(bytes);
  const nodes = json.nodes ?? [];
  const sceneRoots = [...new Set((json.scenes?.[json.scene ?? 0]?.nodes ?? []).filter(Number.isInteger))];
  const parentIndices = new Map<number, number[]>();
  const invalidChildReferences: string[] = [];
  nodes.forEach((node, parentIndex) => {
    for (const childIndex of node.children ?? []) {
      if (!Number.isInteger(childIndex) || childIndex < 0 || childIndex >= nodes.length) {
        invalidChildReferences.push(`${nodeName(nodes, parentIndex)}->${String(childIndex)}`);
        continue;
      }
      const parents = parentIndices.get(childIndex) ?? [];
      parents.push(parentIndex);
      parentIndices.set(childIndex, parents);
    }
  });
  const multipleParentNodes = [...parentIndices.entries()]
    .filter(([, parents]) => parents.length > 1)
    .map(([index, parents]) => `${nodeName(nodes, index)}<-${parents.map((parent) => nodeName(nodes, parent)).join(",")}`);
  const cycles = findHierarchyCycles(nodes);
  const transforms = nodes.map((node, index): CharacterNodeTransformInspection => {
    const decomposed = node.matrix?.length === 16
      ? matrixTransform(node.matrix)
      : {
        translation: vector(node.translation, identityTranslation),
        rotation: vector(node.rotation, identityRotation),
        scale: vector(node.scale, identityScale)
      };
    return Object.freeze({
      index,
      name: nodeName(nodes, index),
      translation: Object.freeze(decomposed.translation),
      rotation: Object.freeze(decomposed.rotation),
      scale: Object.freeze(decomposed.scale),
      ...(node.matrix?.length === 16 ? { matrix: Object.freeze([...node.matrix]) } : {}),
      mesh: node.mesh !== undefined,
      skin: node.skin !== undefined
    });
  });
  const hierarchySkins = (json.skins ?? []).map((skin, index) => {
    const joints = (skin.joints ?? []).filter(Number.isInteger);
    const invalidJoints = joints.filter((joint) => joint < 0 || joint >= nodes.length);
    const reachable = skin.skeleton === undefined || invalidJoints.length > 0
      ? new Set<number>()
      : descendants(nodes, skin.skeleton);
    const unreachableJoints = skin.skeleton === undefined
      ? []
      : joints.filter((joint) => !reachable.has(joint));
    return Object.freeze({
      index,
      ...(skin.skeleton === undefined ? {} : { skeleton: skin.skeleton }),
      joints: Object.freeze(joints),
      invalidJoints: Object.freeze(invalidJoints),
      unreachableJoints: Object.freeze(unreachableJoints)
    });
  });
  const images = (json.images ?? []).map((image, index) => inspectImage(
    image,
    index,
    json.bufferViews ?? [],
    binary
  ));
  const textureImageIndices = (json.textures ?? []).map((texture) =>
    texture.extensions?.EXT_texture_webp?.source
      ?? texture.extensions?.KHR_texture_basisu?.source
      ?? texture.source
      ?? -1
  );
  const nonUnitScaleNodes = transforms
    .filter((node) => !approximatelyVector(node.scale, identityScale))
    .map((node) => `${node.name}:${node.scale.map(formatNumber).join(",")}`);
  const nonIdentitySceneRoots = sceneRoots.flatMap((index) => {
    const transform = transforms[index];
    if (!transform) return [`missing-root:${index}`];
    const sourceMatrix = nodes[index]?.matrix;
    const identity = sourceMatrix?.length === 16
      ? approximatelyVector(sourceMatrix, identityMatrix)
      : approximatelyVector(transform.translation, identityTranslation)
        && approximatelyVector(transform.rotation, identityRotation)
        && approximatelyVector(transform.scale, identityScale);
    return identity
      ? []
      : [`${transform.name}:t=${transform.translation.map(formatNumber).join(",")};r=${transform.rotation.map(formatNumber).join(",")};s=${transform.scale.map(formatNumber).join(",")}`];
  });

  return Object.freeze({
    ...(json.asset?.generator ? { generator: json.asset.generator } : {}),
    extensionsUsed: Object.freeze([...(json.extensionsUsed ?? [])]),
    assetExtras: Object.freeze({ ...(json.asset?.extras ?? {}) }),
    animations: Object.freeze((json.animations ?? []).map((animation, index) => animation.name ?? `animation-${index}`)),
    textures: Object.freeze(images),
    textureImageIndices: Object.freeze(textureImageIndices),
    nodes: Object.freeze(transforms),
    nonUnitScaleNodes: Object.freeze(nonUnitScaleNodes),
    nonIdentitySceneRoots: Object.freeze(nonIdentitySceneRoots),
    hierarchy: Object.freeze({
      sceneRoots: Object.freeze(sceneRoots),
      invalidChildReferences: Object.freeze(invalidChildReferences),
      multipleParentNodes: Object.freeze(multipleParentNodes),
      cycles: Object.freeze(cycles),
      skins: Object.freeze(hierarchySkins)
    })
  });
}

export function auditCharacterAsset(
  manifest: CharacterAssetManifest,
  baseValidation: CharacterAssetValidation,
  inspection: CharacterGlbAuditInspection,
  canonicalClipNames: readonly string[],
  policy: CharacterAssetAuditPolicy
): CharacterAssetAudit {
  const errors = [...baseValidation.errors];
  const warnings = [...baseValidation.warnings];
  if (manifest.status !== policy.classification) {
    errors.push(`classification-mismatch:${manifest.status}/${policy.classification}`);
  }
  const requiredClips = [...new Set(canonicalClipNames)];
  const missing = requiredClips.filter((clip) => !inspection.animations.includes(clip));
  const canonicalCoverage = {
    covered: requiredClips.length - missing.length,
    required: requiredClips.length,
    missing: Object.freeze(missing)
  };
  if (missing.length > 0) {
    const detail = `canonical-animation-coverage:${canonicalCoverage.covered}/${canonicalCoverage.required}:missing=${missing.join(",")}`;
    if (manifest.status === "canonical") {
      errors.push(detail);
    } else if (policy.canonicalCoverageException?.reason.trim()) {
      warnings.push(`interim-${detail};exception=${policy.canonicalCoverageException.reason}`);
    } else {
      errors.push(`undocumented-${detail}`);
    }
  }

  if (policy.requireTextures && inspection.textures.length === 0) errors.push("processed-textures:missing");
  for (const texture of inspection.textures) {
    if (texture.declaredMimeType && texture.detectedMimeType && texture.declaredMimeType !== texture.detectedMimeType) {
      errors.push(`processed-texture-mime-mismatch:${texture.name}:${texture.declaredMimeType}/${texture.detectedMimeType}`);
    }
    if (!texture.mimeType || !policy.processedTextureMimeTypes.includes(texture.mimeType)) {
      errors.push(`processed-texture-format:${texture.name}:${texture.mimeType ?? "unknown"}`);
    }
    if (texture.width === undefined || texture.height === undefined) {
      errors.push(`processed-texture-dimensions-uninspectable:${texture.name}`);
    } else if (texture.width > policy.maxTextureWidth || texture.height > policy.maxTextureHeight) {
      errors.push(`processed-texture-dimensions:${texture.name}:${texture.width}x${texture.height}`);
    }
    if (policy.requireEmbeddedTextures && !texture.embedded) {
      errors.push(`processed-texture-not-embedded:${texture.name}`);
    }
  }
  inspection.textureImageIndices.forEach((imageIndex, textureIndex) => {
    if (imageIndex < 0 || imageIndex >= inspection.textures.length) {
      errors.push(`texture-source-invalid:${textureIndex}:${imageIndex}`);
    }
  });
  if (policy.requireAttributionExtras) {
    for (const key of ["author", "license", "source"] as const) {
      if (typeof inspection.assetExtras[key] !== "string" || inspection.assetExtras[key].trim().length === 0) {
        errors.push(`asset-extra-missing:${key}`);
      }
    }
  }

  const hierarchyIssues = [
    ...inspection.hierarchy.invalidChildReferences.map((issue) => `hierarchy-invalid-child:${issue}`),
    ...inspection.hierarchy.multipleParentNodes.map((issue) => `hierarchy-multiple-parent:${issue}`),
    ...inspection.hierarchy.cycles.map((issue) => `hierarchy-cycle:${issue}`),
    ...inspection.hierarchy.skins.flatMap((skin) => [
      ...skin.invalidJoints.map((joint) => `skin-${skin.index}-invalid-joint:${joint}`),
      ...skin.unreachableJoints.map((joint) => `skin-${skin.index}-unreachable-joint:${joint}`)
    ])
  ];
  errors.push(...hierarchyIssues);

  if (inspection.nonUnitScaleNodes.length > 0) {
    if (policy.requireUnitScale || manifest.status === "canonical") {
      errors.push(`canonical-non-unit-scale:${inspection.nonUnitScaleNodes.join("|")}`);
    } else if (policy.scaleException?.reason.trim()) {
      warnings.push(`interim-non-unit-scale:${inspection.nonUnitScaleNodes.join("|")};exception=${policy.scaleException.reason}`);
    } else {
      errors.push(`undocumented-non-unit-scale:${inspection.nonUnitScaleNodes.join("|")}`);
    }
  }
  if (inspection.nonIdentitySceneRoots.length > 0) {
    if (policy.requireIdentitySceneRoots || manifest.status === "canonical") {
      errors.push(`canonical-non-identity-scene-root:${inspection.nonIdentitySceneRoots.join("|")}`);
    } else {
      warnings.push(`interim-non-identity-scene-root:${inspection.nonIdentitySceneRoots.join("|")}`);
    }
  }

  return Object.freeze({
    errors: Object.freeze([...new Set(errors)]),
    warnings: Object.freeze([...new Set(warnings)]),
    canonicalCoverage: Object.freeze(canonicalCoverage)
  });
}

function parseGlb(bytes: Uint8Array): { json: GltfJson; binary?: Uint8Array } {
  if (bytes.byteLength < 20) throw new Error("GLB is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Invalid GLB magic");
  if (view.getUint32(4, true) !== 2) throw new Error(`Unsupported GLB version ${view.getUint32(4, true)}`);
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error("GLB declared length does not match file size");
  let offset = 12;
  let json: GltfJson | undefined;
  let binary: Uint8Array | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength) throw new Error("GLB chunk extends beyond the file");
    if (type === GLB_JSON_CHUNK) {
      json = JSON.parse(trimGlbJsonPadding(new TextDecoder().decode(bytes.subarray(start, end)))) as GltfJson;
    } else if (type === GLB_BINARY_CHUNK && binary === undefined) {
      binary = bytes.subarray(start, end);
    }
    offset = end;
  }
  if (!json) throw new Error("GLB does not contain a JSON chunk");
  return { json, ...(binary ? { binary } : {}) };
}

function inspectImage(
  image: NonNullable<GltfJson["images"]>[number],
  index: number,
  bufferViews: NonNullable<GltfJson["bufferViews"]>,
  binary?: Uint8Array
): CharacterTextureInspection {
  const name = image.name ?? `image-${index}`;
  let source: CharacterTextureInspection["source"] = "missing";
  let embedded = false;
  let payload: Uint8Array | undefined;
  if (image.bufferView !== undefined) {
    source = "buffer-view";
    embedded = true;
    const view = bufferViews[image.bufferView];
    if (view && binary && (view.buffer ?? 0) === 0 && view.byteLength !== undefined) {
      const start = view.byteOffset ?? 0;
      const end = start + view.byteLength;
      if (start >= 0 && end <= binary.byteLength) payload = binary.subarray(start, end);
    }
  } else if (image.uri?.startsWith("data:")) {
    source = "data-uri";
    embedded = true;
    payload = decodeDataUri(image.uri);
  } else if (image.uri) {
    source = "external-uri";
  }
  const detectedMimeType = sniffMimeType(payload);
  const mimeType = image.mimeType ?? detectedMimeType;
  const dimensions = payload && mimeType ? imageDimensions(payload, mimeType) : undefined;
  return Object.freeze({
    index,
    name,
    ...(mimeType ? { mimeType } : {}),
    ...(image.mimeType ? { declaredMimeType: image.mimeType } : {}),
    ...(detectedMimeType ? { detectedMimeType } : {}),
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    embedded,
    ...(payload ? { byteLength: payload.byteLength } : {}),
    source
  });
}

function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
  if (mimeType === "image/png" && bytes.byteLength >= 24 && ascii(bytes, 1, 3) === "PNG") {
    const view = dataView(bytes);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  if (mimeType === "image/webp" && bytes.byteLength >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const view = dataView(bytes);
    const format = ascii(bytes, 12, 4);
    if (format === "VP8X") {
      return { width: readUint24(bytes, 24) + 1, height: readUint24(bytes, 27) + 1 };
    }
    if (format === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (format === "VP8 " && bytes.byteLength >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
  }
  if (mimeType === "image/ktx2" && bytes.byteLength >= 28 && isKtx2(bytes)) {
    const view = dataView(bytes);
    return { width: view.getUint32(20, true), height: view.getUint32(24, true) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return undefined;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1] ?? 0;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

function decodeDataUri(uri: string): Uint8Array | undefined {
  const separator = uri.indexOf(",");
  if (separator < 0) return undefined;
  const metadata = uri.slice(0, separator);
  const payload = uri.slice(separator + 1);
  try {
    return metadata.endsWith(";base64")
      ? Uint8Array.from(Buffer.from(payload, "base64"))
      : new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return undefined;
  }
}

function sniffMimeType(bytes?: Uint8Array): string | undefined {
  if (!bytes) return undefined;
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.byteLength >= 8 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (isKtx2(bytes)) return "image/ktx2";
  return undefined;
}

function findHierarchyCycles(nodes: NonNullable<GltfJson["nodes"]>): string[] {
  const cycles = new Set<string>();
  const visit = (index: number, ancestors: number[], visited: Set<number>) => {
    if (ancestors.includes(index)) {
      const cycle = [...ancestors.slice(ancestors.indexOf(index)), index].map((node) => nodeName(nodes, node)).join("->");
      cycles.add(cycle);
      return;
    }
    if (visited.has(index) || !nodes[index]) return;
    visited.add(index);
    for (const child of nodes[index].children ?? []) {
      if (Number.isInteger(child) && child >= 0 && child < nodes.length) visit(child, [...ancestors, index], visited);
    }
  };
  const visited = new Set<number>();
  nodes.forEach((_, index) => visit(index, [], visited));
  return [...cycles];
}

function descendants(nodes: NonNullable<GltfJson["nodes"]>, root: number): Set<number> {
  const result = new Set<number>();
  const pending = [root];
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === undefined || result.has(index) || !nodes[index]) continue;
    result.add(index);
    pending.push(...(nodes[index].children ?? []));
  }
  return result;
}

function matrixTransform(matrix: readonly number[]): { translation: number[]; rotation: number[]; scale: number[] } {
  const scale = [
    Math.hypot(matrix[0] ?? 0, matrix[1] ?? 0, matrix[2] ?? 0),
    Math.hypot(matrix[4] ?? 0, matrix[5] ?? 0, matrix[6] ?? 0),
    Math.hypot(matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 0)
  ];
  return {
    translation: [matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0],
    rotation: identityRotation.slice(),
    scale
  };
}

function vector(values: readonly number[] | undefined, fallback: readonly number[]): number[] {
  return values?.length === fallback.length ? [...values] : [...fallback];
}

function approximatelyVector(actual: readonly number[], expected: readonly number[], epsilon = 1e-5): boolean {
  return actual.length === expected.length && actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= epsilon);
}

function nodeName(nodes: NonNullable<GltfJson["nodes"]>, index: number): string {
  return nodes[index]?.name ?? `node-${index}`;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isKtx2(bytes: Uint8Array): boolean {
  const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.byteLength >= identifier.length && identifier.every((value, index) => bytes[index] === value);
}

function trimGlbJsonPadding(value: string): string {
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 0 && code !== 32) break;
    end -= 1;
  }
  return value.slice(0, end);
}
