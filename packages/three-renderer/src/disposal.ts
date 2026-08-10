import {
  BufferGeometry,
  Material,
  Object3D,
  Texture,
  type Mesh
} from "three";

const disposedGeometries = new WeakSet<BufferGeometry>();
const disposedMaterials = new WeakSet<Material>();
const disposedTextures = new WeakSet<Texture>();

export type DisposeObjectOptions = Readonly<{
  geometries?: boolean;
  materials?: boolean;
  textures?: boolean;
  detach?: boolean;
  clear?: boolean;
}>;

export type DisposalSummary = Readonly<{
  geometries: number;
  materials: number;
  textures: number;
}>;

/** Disposes one geometry at most once, even across overlapping scene subtrees. */
export function disposeGeometryOnce(geometry: BufferGeometry): boolean {
  if (disposedGeometries.has(geometry)) return false;
  disposedGeometries.add(geometry);
  geometry.dispose();
  return true;
}

/** Disposes material textures and the material itself at most once. */
export function disposeMaterialOnce(material: Material, disposeTextures = true): DisposalSummary {
  if (disposedMaterials.has(material)) return emptySummary();
  let textures = 0;
  if (disposeTextures) {
    for (const texture of materialTextures(material)) {
      if (disposeTextureOnce(texture)) textures += 1;
    }
  }
  disposedMaterials.add(material);
  material.dispose();
  return Object.freeze({ geometries: 0, materials: 1, textures });
}

export function disposeTextureOnce(texture: Texture): boolean {
  if (disposedTextures.has(texture)) return false;
  disposedTextures.add(texture);
  texture.dispose();
  return true;
}

/**
 * Traverses a subtree, de-duplicates shared resources, then optionally detaches
 * and clears it. Ownership flags let character instances release per-agent
 * materials without disposing the shared geometry pool.
 */
export function disposeObject3D(
  root: Object3D,
  options: DisposeObjectOptions = {}
): DisposalSummary {
  const shouldDisposeGeometries = options.geometries ?? true;
  const shouldDisposeMaterials = options.materials ?? true;
  const shouldDisposeTextures = options.textures ?? true;
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    if (mesh.geometry instanceof BufferGeometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        if (entry instanceof Material) materials.add(entry);
      }
    } else if (material instanceof Material) {
      materials.add(material);
    }
  });

  let geometryCount = 0;
  let materialCount = 0;
  let textureCount = 0;
  if (shouldDisposeGeometries) {
    for (const geometry of geometries) {
      if (disposeGeometryOnce(geometry)) geometryCount += 1;
    }
  }
  if (shouldDisposeMaterials) {
    for (const material of materials) {
      const summary = disposeMaterialOnce(material, shouldDisposeTextures);
      materialCount += summary.materials;
      textureCount += summary.textures;
    }
  }
  if (options.detach ?? true) root.removeFromParent();
  if (options.clear ?? true) root.clear();
  return Object.freeze({
    geometries: geometryCount,
    materials: materialCount,
    textures: textureCount
  });
}

function materialTextures(material: Material): Set<Texture> {
  const textures = new Set<Texture>();
  const values = Object.values(material as unknown as Record<string, unknown>);
  for (const value of values) collectTextures(value, textures, 0);
  return textures;
}

function collectTextures(value: unknown, textures: Set<Texture>, depth: number): void {
  if (value instanceof Texture) {
    textures.add(value);
    return;
  }
  if (depth >= 2 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectTextures(entry, textures, depth + 1);
    return;
  }
  // Shader uniforms are nested one level; avoid walking arbitrary Three.js
  // object graphs deeply because they may be cyclic.
  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectTextures(entry, textures, depth + 1);
  }
}

function emptySummary(): DisposalSummary {
  return Object.freeze({ geometries: 0, materials: 0, textures: 0 });
}
