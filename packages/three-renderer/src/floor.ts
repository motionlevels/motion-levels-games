import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShadowMaterial,
  Vector3
} from "three";
import { FLOOR_COLS, FLOOR_ROWS, FRAME_SIZE, type Frame } from "@motion-levels-games/game-sdk";
import {
  DEFAULT_FLOOR_COLOR,
  RENDERER_GRID_TO_WORLD,
  floorColorsFromFrame,
  rendererGridToWorld
} from "./contracts.ts";
import { disposeObject3D } from "./disposal.ts";

const TILE_GAP = 0.035;

/** Authoritative 16x32 instanced floor. It owns every Three.js resource it creates. */
export class InstancedFrameFloor {
  public readonly object = new Group();
  public readonly mesh: InstancedMesh;
  readonly #shadowCatcher: Mesh;
  readonly #color = new Color();
  #disposed = false;

  public constructor() {
    this.object.name = "motion-levels-frame-floor";
    const tileSize = RENDERER_GRID_TO_WORLD.tileSize;
    const geometry = new PlaneGeometry(tileSize - TILE_GAP, tileSize - TILE_GAP);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false
    });
    this.mesh = new InstancedMesh(geometry, material, FRAME_SIZE);
    this.mesh.name = "authoritative-frame-instances";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;

    const matrix = new Matrix4();
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const index = y * FLOOR_COLS + x;
        const world = rendererGridToWorld({ x, y });
        matrix.makeRotationX(-Math.PI / 2);
        matrix.setPosition(world.x, world.y, world.z);
        this.mesh.setMatrixAt(index, matrix);
        this.mesh.setColorAt(index, this.#color.set(DEFAULT_FLOOR_COLOR));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.#shadowCatcher = createShadowCatcher();
    this.object.add(this.mesh, this.#shadowCatcher, createGridLines());
  }

  public update(frame: Frame): void {
    this.#assertActive();
    const colors = floorColorsFromFrame(frame);
    for (let index = 0; index < colors.length; index += 1) {
      this.mesh.setColorAt(index, this.#color.set(colors[index] as string));
    }
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }

  public setReceiveShadow(receiveShadow: boolean): void {
    this.#assertActive();
    this.#shadowCatcher.visible = receiveShadow;
    this.#shadowCatcher.receiveShadow = receiveShadow;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    disposeObject3D(this.object);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("InstancedFrameFloor has been disposed");
  }
}

function createShadowCatcher(): Mesh {
  const width = FLOOR_COLS * RENDERER_GRID_TO_WORLD.tileSize;
  const height = FLOOR_ROWS * RENDERER_GRID_TO_WORLD.tileSize;
  const geometry = new PlaneGeometry(width, height);
  const material = new ShadowMaterial({ color: 0x000000, opacity: 0.24, transparent: true });
  const catcher = new Mesh(geometry, material);
  catcher.name = "floor-shadow-catcher";
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = RENDERER_GRID_TO_WORLD.floorY + 0.003;
  catcher.receiveShadow = true;
  catcher.renderOrder = 2;
  return catcher;
}

function createGridLines(): LineSegments {
  const tileSize = RENDERER_GRID_TO_WORLD.tileSize;
  const first = rendererGridToWorld({ x: 0, y: 0 });
  const last = rendererGridToWorld({ x: FLOOR_COLS - 1, y: FLOOR_ROWS - 1 });
  const minX = first.x - tileSize / 2;
  const maxX = last.x + tileSize / 2;
  const minZ = first.z - tileSize / 2;
  const maxZ = last.z + tileSize / 2;
  const points: Vector3[] = [];
  for (let x = 0; x <= FLOOR_COLS; x += 1) {
    const worldX = minX + x * tileSize;
    points.push(new Vector3(worldX, RENDERER_GRID_TO_WORLD.floorY + 0.002, minZ));
    points.push(new Vector3(worldX, RENDERER_GRID_TO_WORLD.floorY + 0.002, maxZ));
  }
  for (let y = 0; y <= FLOOR_ROWS; y += 1) {
    const worldZ = minZ + y * tileSize;
    points.push(new Vector3(minX, RENDERER_GRID_TO_WORLD.floorY + 0.002, worldZ));
    points.push(new Vector3(maxX, RENDERER_GRID_TO_WORLD.floorY + 0.002, worldZ));
  }
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({ color: 0x273746, transparent: true, opacity: 0.55 });
  const lines = new LineSegments(geometry, material);
  lines.name = "floor-grid-lines";
  lines.renderOrder = 1;
  return lines;
}
