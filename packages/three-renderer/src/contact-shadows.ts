import {
  CircleGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3
} from "three";
import { RENDERER_GRID_TO_WORLD } from "./contracts.ts";
import { disposeObject3D } from "./disposal.ts";

const SHADOW_DIAMETER = 0.78;
const FLOOR_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const SHADOW_SCALE = new Vector3(SHADOW_DIAMETER, SHADOW_DIAMETER, SHADOW_DIAMETER);

/** One draw for every cheap per-character contact shadow in the scene. */
export class InstancedContactShadows {
  public readonly object: InstancedMesh;
  readonly #capacity: number;
  readonly #matrix = new Matrix4();
  readonly #position = new Vector3();
  #count = 0;
  #disposed = false;

  public constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Contact-shadow capacity must be a positive integer");
    }
    this.#capacity = capacity;
    this.object = new InstancedMesh(
      new CircleGeometry(0.5, 20),
      new MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        toneMapped: false
      }),
      capacity
    );
    this.object.name = "instanced-contact-shadows";
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.renderOrder = 2;
  }

  public beginFrame(): void {
    this.#assertActive();
    this.#count = 0;
  }

  public add(x: number, z: number): void {
    this.#assertActive();
    if (this.#count >= this.#capacity) return;
    this.#position.set(x, RENDERER_GRID_TO_WORLD.floorY + 0.012, z);
    this.#matrix.compose(this.#position, FLOOR_ROTATION, SHADOW_SCALE);
    this.object.setMatrixAt(this.#count, this.#matrix);
    this.#count += 1;
  }

  public commit(): void {
    this.#assertActive();
    this.object.count = this.#count;
    this.object.visible = this.#count > 0;
    if (this.#count > 0) this.object.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    disposeObject3D(this.object);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("InstancedContactShadows has been disposed");
  }
}
