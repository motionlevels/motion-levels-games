import assert from "node:assert/strict";
import test from "node:test";
import { MeshBasicMaterial } from "three";
import { FLOOR_COLS, FLOOR_ROWS, FRAME_SIZE, type Frame } from "@motion-levels-games/game-sdk";
import {
  floorCellIndex,
  floorColorsFromFrame,
  InstancedFrameFloor,
  rendererGridToWorld,
  rendererQualitySettings,
  selectRendererLod,
  snapshotDebugData
} from "../src/index.ts";

test("the authoritative floor maps shuffled cells without mutating Frame", () => {
  const frame: Frame = {
    width: FLOOR_COLS,
    height: FLOOR_ROWS,
    cells: [
      { x: 15, y: 31, color: "#ff0000" },
      { x: 0, y: 0, color: "#00ff00" },
      { x: 4, y: 7, color: "#0000ff" }
    ]
  };
  const before = structuredClone(frame);
  const colors = floorColorsFromFrame(frame, "#000000");
  assert.equal(colors.length, FRAME_SIZE);
  assert.equal(colors[floorCellIndex(0, 0)], "#00ff00");
  assert.equal(colors[floorCellIndex(4, 7)], "#0000ff");
  assert.equal(colors[floorCellIndex(15, 31)], "#ff0000");
  assert.equal(colors[floorCellIndex(1, 0)], "#000000");
  assert.deepEqual(frame, before);
  assert.equal(Object.isFrozen(colors), true);
  assert.deepEqual(rendererGridToWorld({ x: 0, y: 0 }), { x: -1.875, y: 0, z: -3.875 });
  assert.deepEqual(rendererGridToWorld({ x: 15, y: 31 }), { x: 1.875, y: 0, z: 3.875 });
  assert.throws(() => floorColorsFromFrame({ ...frame, width: 8 as 16 }), /16x32/);
  assert.throws(() => floorCellIndex(16, 0), /outside/);

  const floor = new InstancedFrameFloor();
  const material = floor.mesh.material;
  assert.ok(material instanceof MeshBasicMaterial);
  assert.equal(
    material.vertexColors,
    false,
    "instanceColor must not be multiplied by an absent per-vertex color attribute"
  );
  assert.equal(floor.mesh.geometry.getAttribute("color"), undefined);
  assert.ok(floor.mesh.instanceColor, "the floor supplies authoritative colors through instanceColor");
  floor.dispose();
});

test("debug paths, reservations, and targets are defensive immutable snapshots", () => {
  const point = { x: 2, y: 3 };
  const points = [point, { x: 3, y: 4 }];
  const input = {
    paths: [{ id: "route", points, color: "#abcdef" as const }],
    reservations: [{ id: "hold", ownerId: "agent-a", points: [point] }],
    targets: [{ id: "goal", position: point, radiusTiles: 1.25 }]
  };
  const data = snapshotDebugData(input);
  point.x = 9;
  points.push({ x: 5, y: 5 });
  assert.deepEqual(data.paths[0]?.points, [{ x: 2, y: 3 }, { x: 3, y: 4 }]);
  assert.deepEqual(data.reservations[0]?.points, [{ x: 2, y: 3 }]);
  assert.deepEqual(data.targets[0]?.position, { x: 2, y: 3 });
  assert.equal(Object.isFrozen(data), true);
  assert.equal(Object.isFrozen(data.paths), true);
  assert.equal(Object.isFrozen(data.paths[0]?.points[0]), true);
  assert.throws(() => snapshotDebugData({ paths: [{ id: "short", points: [{ x: 0, y: 0 }] }] }), /two points/);
  assert.throws(() => snapshotDebugData({ targets: [{ id: "bad", position: { x: -1, y: 0 } }] }), /outside/);
});

test("quality settings choose DPR, shadow behavior, and all LOD boundaries", () => {
  const mobile = rendererQualitySettings["mobile-low"];
  assert.equal(mobile.dprCap, 1);
  assert.equal(mobile.contactShadows, false);
  assert.equal(mobile.shadowMapEnabled, false);
  assert.equal(selectRendererLod(mobile.lodDistances[0], mobile), "high");
  assert.equal(selectRendererLod(mobile.lodDistances[0] + 0.01, mobile), "medium");
  assert.equal(selectRendererLod(mobile.lodDistances[1] + 0.01, mobile), "low");
  assert.equal(selectRendererLod(mobile.hiddenDistance + 0.01, mobile), "hidden");
  assert.equal(rendererQualitySettings.capture.shadowMapEnabled, true);
  assert.equal(rendererQualitySettings.capture.maxCharacters, 10);
  assert.throws(() => selectRendererLod(-1, mobile), /non-negative/);
});
