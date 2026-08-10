import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PCFShadowMap, type Object3D, type Scene, type WebGLRenderer, type WebGLRendererParameters } from "three";
import { FLOOR_COLS, FLOOR_ROWS, FRAME_SIZE, type Frame } from "@motion-levels-games/game-sdk";
import {
  AgentSceneRenderer,
  createAgentSceneRenderer,
  type AgentRenderSnapshot
} from "../src/index.ts";

test("the scene renderer is timeline-driven, bounded, resizable, and fully disposable without WebGL", () => {
  const backend = fakeRenderer();
  let clock = 0;
  const samples: number[] = [];
  const scene = new AgentSceneRenderer({
    canvas: fakeCanvas(),
    width: 640,
    height: 360,
    devicePixelRatio: 3,
    interpolationDelayMillis: 0,
    performanceWindowSize: 2,
    rendererFactory: (_parameters: WebGLRendererParameters) => backend.renderer,
    performanceNow: () => clock++,
    onPerformanceSample: (sample) => samples.push(sample.frameMillis)
  });
  assert.equal(backend.renderer.shadowMap.type, PCFShadowMap);
  assert.equal(backend.pixelRatios.at(-1), 1.5, "desktop DPR is capped");
  assert.equal(scene.floor.mesh.count, FRAME_SIZE);
  scene.setFrame(emptyFrame());
  scene.pushAgentSnapshot(snapshot(0, 0));
  scene.pushAgentSnapshot(snapshot(100, 4));
  const first = scene.render(50);
  const second = scene.render(50);
  assert.equal(first.characters, 1);
  assert.equal(second.animationMillis, first.animationMillis);
  scene.render(100);
  assert.equal(samples.length, 3);
  assert.equal(scene.performanceReport().samples, 2, "performance reports use a bounded window");
  assert.equal(scene.diagnostics().lastRenderAtMillis, 100);
  scene.render(20);
  assert.equal(scene.diagnostics().lastRenderAtMillis, 20, "backward seek resets then renders safely");
  scene.setQualityTier("mobile-low");
  assert.equal(backend.pixelRatios.at(-1), 1);
  scene.resize(320, 180, 2);
  assert.deepEqual(backend.sizes.at(-1), [320, 180, false]);
  scene.dispose();
  scene.dispose();
  assert.equal(backend.disposals, 1);
  assert.equal(backend.contextLosses, 1);
  assert.equal(backend.renderListDisposals, 1);
  assert.equal(scene.diagnostics().disposed, true);
  assert.throws(() => scene.render(120), /disposed/);
});

test("the next performance sample includes floor, snapshot, and debug preparation cost", () => {
  const backend = fakeRenderer();
  const clockMarks = [0, 2, 2, 5, 5, 9, 9, 13, 14, 14, 15, 16];
  const scene = new AgentSceneRenderer({
    canvas: fakeCanvas(),
    interpolationDelayMillis: 0,
    rendererFactory: () => backend.renderer,
    performanceNow: () => {
      const mark = clockMarks.shift();
      assert.notEqual(mark, undefined, "injected performance clock was read more often than expected");
      return mark as number;
    }
  });

  scene.setFrame(emptyFrame()); // 2 ms
  scene.pushAgentSnapshot(snapshot(0, 0)); // 3 ms
  scene.setDebugData(); // 4 ms
  const prepared = scene.render(0); // 5 ms render/animation work
  const next = scene.render(20); // 2 ms with no pending preparation

  assert.equal(prepared.frameMillis, 14);
  assert.equal(prepared.animationMillis, 4);
  assert.equal(next.frameMillis, 2);
  scene.dispose();
});

test("factory options form is safe when HTMLCanvasElement does not exist in Node", () => {
  const backend = fakeRenderer();
  const scene = createAgentSceneRenderer({
    canvas: fakeCanvas(),
    width: 10,
    height: 10,
    rendererFactory: () => backend.renderer
  });
  assert.ok(scene instanceof AgentSceneRenderer);
  scene.dispose();
});

test("ten desktop athletes stay within the honest total draw-call budget", () => {
  const backend = fakeRenderer(true);
  const scene = new AgentSceneRenderer({
    canvas: fakeCanvas(),
    width: 1_920,
    height: 1_080,
    interpolationDelayMillis: 0,
    rendererFactory: () => backend.renderer
  });
  scene.setFrame(emptyFrame());
  for (let index = 0; index < 10; index += 1) {
    scene.pushAgentSnapshot({
      ...snapshot(0, index),
      id: `agent-${String(index).padStart(2, "0")}`,
      position: { x: index + 3, y: 31 }
    });
  }
  const sample = scene.render(0);
  assert.ok(sample.drawCalls <= 20, `expected at most 20 total calls, received ${sample.drawCalls}`);
  assert.equal(scene.performanceReport().violations.includes("draw-calls"), false);
  assert.equal(visibleNamed(scene.scene, "instanced-contact-shadows"), 1);

  scene.setQualityTier("mobile-low");
  const mobile = scene.render(20);
  assert.equal(scene.diagnostics().renderedCharacters, 6);
  assert.equal(visibleNamed(scene.scene, "instanced-contact-shadows"), 0, "mobile disables contact shadows");
  assert.equal(scene.performanceReport().violations.includes("draw-calls"), false);
  assert.ok(mobile.drawCalls <= 12, `expected at most 12 mobile total calls, received ${mobile.drawCalls}`);
  scene.dispose();
});

test("renderer source depends on presentation contracts, never games or rule/collision runtimes", async () => {
  const sourceFiles = ["contracts", "debug-overlay", "disposal", "floor", "motion-athlete", "renderer", "snapshot-buffer"];
  const sources = await Promise.all(sourceFiles.map((name) =>
    readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8")
  ));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /@motion-levels-games\/agent-runtime/u);
  assert.doesNotMatch(source, /from\s+["'](?:\.\.\/)+games\//u);
  assert.doesNotMatch(source, /\b(?:collision|score|objectiveOwner)\s*\(/u);
});

function emptyFrame(): Frame {
  return { width: FLOOR_COLS, height: FLOOR_ROWS, cells: [] };
}

function snapshot(atMillis: number, x: number): AgentRenderSnapshot {
  return {
    id: "agent-a",
    tick: Math.round(atMillis / 20),
    atMillis,
    position: { x, y: 12 },
    velocity: { x: 1, y: 0 },
    facingRadians: 0,
    grounded: true,
    action: "move",
    intention: "checkpoint",
    emotion: "neutral",
    variant: "explorer"
  };
}

function fakeCanvas(): HTMLCanvasElement {
  return { width: 1, height: 1, clientWidth: 1, clientHeight: 1 } as HTMLCanvasElement;
}

function fakeRenderer(countSceneDraws = false): {
  renderer: WebGLRenderer;
  pixelRatios: number[];
  sizes: Array<[number, number, boolean]>;
  disposals: number;
  contextLosses: number;
  renderListDisposals: number;
} {
  const state = {
    pixelRatios: [] as number[],
    sizes: [] as Array<[number, number, boolean]>,
    disposals: 0,
    contextLosses: 0,
    renderListDisposals: 0
  };
  const renderer = {
    outputColorSpace: "",
    toneMapping: 0,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: 0 },
    info: {
      render: { calls: 7, triangles: 123, frame: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 }
    },
    renderLists: { dispose: () => { state.renderListDisposals += 1; } },
    setPixelRatio: (ratio: number) => { state.pixelRatios.push(ratio); },
    setSize: (width: number, height: number, updateStyle: boolean) => {
      state.sizes.push([width, height, updateStyle]);
    },
    render: (scene: Scene) => {
      if (countSceneDraws) renderer.info.render.calls = visibleDrawCalls(scene);
    },
    setAnimationLoop: () => undefined,
    dispose: () => { state.disposals += 1; },
    forceContextLoss: () => { state.contextLosses += 1; }
  } as unknown as WebGLRenderer;
  return Object.assign(state, { renderer });
}

function visibleDrawCalls(scene: Scene): number {
  let calls = 0;
  scene.traverse((object) => {
    if (!visibleInHierarchy(object)) return;
    const drawable = object as Object3D & {
      isLine?: boolean;
      isLineSegments?: boolean;
      isMesh?: boolean;
      isPoints?: boolean;
      material?: unknown | unknown[];
    };
    if (!drawable.isMesh && !drawable.isLine && !drawable.isLineSegments && !drawable.isPoints) return;
    calls += Array.isArray(drawable.material) ? drawable.material.length : 1;
  });
  return calls;
}

function visibleInHierarchy(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function visibleNamed(scene: Scene, name: string): number {
  const object = scene.getObjectByName(name);
  return object !== undefined && visibleInHierarchy(object) ? 1 : 0;
}
