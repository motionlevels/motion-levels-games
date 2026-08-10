import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { disposeObject3D } from "../src/index.ts";

test("disposal de-duplicates shared geometry, material, and texture resources", () => {
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial();
  const texture = new Texture();
  material.map = texture;
  const root = new Group();
  root.add(new Mesh(geometry, material), new Mesh(geometry, material));
  let geometryDisposals = 0;
  let materialDisposals = 0;
  let textureDisposals = 0;
  geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
  material.addEventListener("dispose", () => { materialDisposals += 1; });
  texture.addEventListener("dispose", () => { textureDisposals += 1; });

  assert.deepEqual(disposeObject3D(root), { geometries: 1, materials: 1, textures: 1 });
  assert.deepEqual({ geometryDisposals, materialDisposals, textureDisposals }, {
    geometryDisposals: 1,
    materialDisposals: 1,
    textureDisposals: 1
  });
  const reused = new Group();
  reused.add(new Mesh(geometry, material));
  assert.deepEqual(disposeObject3D(reused), { geometries: 0, materials: 0, textures: 0 });
});
