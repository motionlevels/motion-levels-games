import {
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3
} from "three";
import {
  DEFAULT_PATH_COLOR,
  DEFAULT_RESERVATION_COLOR,
  DEFAULT_TARGET_COLOR,
  RENDERER_GRID_TO_WORLD,
  rendererGridToWorld,
  snapshotDebugData,
  type RendererDebugData,
  type RendererDebugInput
} from "./contracts.ts";
import { disposeObject3D } from "./disposal.ts";

const DEBUG_Y = 0.045;

export class RendererDebugOverlay {
  public readonly object = new Group();
  #data = snapshotDebugData();
  #disposed = false;

  public constructor() {
    this.object.name = "renderer-debug-overlay";
    this.object.visible = false;
  }

  public get data(): RendererDebugData {
    return this.#data;
  }

  public update(input?: RendererDebugInput): void {
    this.#assertActive();
    this.#clearObjects();
    this.#data = snapshotDebugData(input);
    for (const path of this.#data.paths) {
      const geometry = new BufferGeometry().setFromPoints(path.points.map((point) => {
        const world = rendererGridToWorld(point);
        return new Vector3(world.x, world.y + DEBUG_Y, world.z);
      }));
      const material = new LineBasicMaterial({
        color: new Color(path.color ?? DEFAULT_PATH_COLOR),
        depthTest: false,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
      });
      const line = new Line(geometry, material);
      line.name = `debug-path:${path.id}`;
      line.renderOrder = 10;
      this.object.add(line);
    }
    for (const reservation of this.#data.reservations) {
      const half = RENDERER_GRID_TO_WORLD.tileSize * 0.42;
      const vertices: Vector3[] = [];
      for (const point of reservation.points) {
        const world = rendererGridToWorld(point);
        const y = world.y + DEBUG_Y * 0.72;
        vertices.push(
          new Vector3(world.x - half, y, world.z - half), new Vector3(world.x + half, y, world.z - half),
          new Vector3(world.x + half, y, world.z - half), new Vector3(world.x + half, y, world.z + half),
          new Vector3(world.x + half, y, world.z + half), new Vector3(world.x - half, y, world.z + half),
          new Vector3(world.x - half, y, world.z + half), new Vector3(world.x - half, y, world.z - half)
        );
      }
      const geometry = new BufferGeometry().setFromPoints(vertices);
      const material = new LineBasicMaterial({
        color: new Color(reservation.color ?? DEFAULT_RESERVATION_COLOR),
        depthTest: false,
        transparent: true,
        opacity: 0.8,
        toneMapped: false
      });
      const lines = new LineSegments(geometry, material);
      lines.name = `debug-reservation:${reservation.id}`;
      lines.renderOrder = 9;
      this.object.add(lines);
    }
    for (const target of this.#data.targets) {
      const radius = (target.radiusTiles ?? 0.6) * RENDERER_GRID_TO_WORLD.tileSize;
      const geometry = new RingGeometry(radius * 0.72, radius, 24);
      const material = new MeshBasicMaterial({
        color: new Color(target.color ?? DEFAULT_TARGET_COLOR),
        depthTest: false,
        transparent: true,
        opacity: 0.78,
        toneMapped: false
      });
      const ring = new Mesh(geometry, material);
      const world = rendererGridToWorld(target.position);
      ring.name = `debug-target:${target.id}`;
      ring.position.set(world.x, world.y + DEBUG_Y * 1.2, world.z);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 11;
      this.object.add(ring);
    }
    this.object.visible = this.object.children.length > 0;
  }

  public clear(): void {
    this.update();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearObjects();
    this.object.removeFromParent();
  }

  #clearObjects(): void {
    for (const child of [...this.object.children]) disposeObject3D(child);
    this.object.clear();
    this.object.visible = false;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("RendererDebugOverlay has been disposed");
  }
}
