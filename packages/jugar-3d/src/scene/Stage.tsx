"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { Robot } from "../characters/Robot.tsx";
import { characterComponent } from "../characters/components.ts";
import type { GameSession } from "../core/session.ts";
import { FLOOR_WORLD_DEPTH, FLOOR_WORLD_WIDTH, TILE_TOP_Y, tileToWorld } from "../core/tileMath.ts";
import {
  JugarStagePerformanceMonitor,
  bytesToMegabytes,
  estimateJugarStageMemoryProxy,
  type JugarStageDiagnostics,
  type JugarStageMemoryProxy,
  type JugarStageQuality,
  type JugarStageRendererEnvironment
} from "../performance.ts";
import { Arena } from "./Arena.tsx";
import { TileFloor, pointToTile } from "./TileFloor.tsx";
import { TV_BOUNDS, TvDisplay } from "./TvDisplay.tsx";

export type JugarStageProps = Readonly<{
  session: GameSession;
  characterId: string;
  sahurModelUrl?: string;
  characterModelBaseUrl?: string;
  /** Opt in only for hosts that synchronously read pixels from the canvas. */
  captureFrames?: boolean;
  /** Explicit test/embed override; browser media-query detection is the default. */
  coarsePointer?: boolean;
  /** Exposes camera-fit measurements on window.__jugar3dFit for host diagnostics. */
  exposeFitDebug?: boolean;
  debug?: JugarStageDebugOptions;
  quality?: JugarStageQuality;
  /** Bounded rolling WebGL diagnostics; omitted hosts pay no sampling cost. */
  onDiagnostics?: (diagnostics: JugarStageDiagnostics) => void;
}>;

export type { JugarStageQuality } from "../performance.ts";

export type JugarStageDebugOptions = Readonly<{
  paths?: boolean;
  targets?: boolean;
  selectedAvatarId?: number;
}>;

/**
 * True on touch devices. Session-stable: used to size the render budget and
 * to disable the pointer parallax, whose one-frame CSS3D lag reads as TV
 * flicker while dragging on mobile.
 */
function detectsCoarsePointer(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}

/** The playable 3D stage: LED floor, robots, TV and venue dressing. */
export default function Stage({
  session,
  characterId,
  sahurModelUrl,
  characterModelBaseUrl,
  captureFrames = false,
  coarsePointer = detectsCoarsePointer(),
  exposeFitDebug = false,
  debug,
  quality = "desktop-medium",
  onDiagnostics
}: JugarStageProps) {
  const Character = characterComponent(characterId);
  const draggingRef = useRef(false);
  // Stable 2D TV compositing and pointer parallax are mutually exclusive.
  // Hosts can select the mobile quality tier explicitly (for example after a
  // responsive breakpoint) even when the browser's pointer media query still
  // reports a fine pointer. Keep the camera static whenever the stable TV
  // surface is active so the canvas and DOM projection cannot drift apart.
  const stableTvCompositing = quality === "mobile-low" || coarsePointer;

  useEffect(() => {
    const stopDragging = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  const handleTilePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      if (event.nativeEvent.button === 2) {
        session.jump();
        return;
      }
      draggingRef.current = true;
      session.moveTo(pointToTile(event.point));
    },
    [session]
  );

  /** Dragging with the button held re-targets the robot continuously. */
  const handleTilePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!draggingRef.current) {
        return;
      }
      event.stopPropagation();
      session.moveTo(pointToTile(event.point));
    },
    [session]
  );

  return (
    <Canvas
      camera={{ fov: 42, near: 0.1, far: 220, position: [0, 14, 20] }}
      // Mobile GPUs pay dearly for extra pixels; 1.5x is visually plenty.
      dpr={quality === "mobile-low" || coarsePointer ? [1, 1.25] : [1, 2]}
      // Pixel retention costs a per-frame copy, so hosts opt in explicitly.
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: captureFrames
      }}
      onContextMenu={(event) => event.preventDefault()}
      shadows={{ enabled: quality !== "mobile-low", type: THREE.PCFShadowMap }}
      style={{ touchAction: "none" }}
    >
      <color args={["#04070a"]} attach="background" />

      <ambientLight color="#5b7683" intensity={0.6} />
      <directionalLight
        castShadow={quality !== "mobile-low"}
        color="#cfeaff"
        intensity={1.15}
        position={[7, 14, 8]}
        shadow-camera-bottom={-12}
        shadow-camera-far={44}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={12}
        shadow-mapSize={quality === "venue-high" || quality === "capture"
          ? [2048, 2048]
          : quality === "mobile-low" || coarsePointer
            ? [512, 512]
            : [1024, 1024]}
      />
      <pointLight color="#23d5ff" distance={18} intensity={16} position={[-5, 3.4, -6]} />
      <pointLight color="#b8ff00" distance={15} intensity={10} position={[5, 2.6, 5]} />

      <Arena />
      <TileFloor
        onTilePointerDown={handleTilePointerDown}
        onTilePointerMove={handleTilePointerMove}
        session={session}
      />
      <TvDisplay
        session={session}
        stableCompositing={stableTvCompositing}
      />
      {debug?.paths || debug?.targets ? <SessionDebugOverlay debug={debug} session={session} /> : null}

      {onDiagnostics ? (
        <StagePerformanceProbe
          coarsePointer={coarsePointer}
          onDiagnostics={onDiagnostics}
          quality={quality}
        />
      ) : null}

      {session.avatars.map((avatar) =>
        avatar.isBot && debug?.selectedAvatarId !== avatar.id ? (
          <Robot avatar={avatar} key={avatar.id} session={session} />
        ) : (
          // Each streamed skin owns its boundary. The canonical athlete stays
          // visible until the GLB is ready instead of making every avatar pop out.
          <Suspense
            fallback={<Robot avatar={avatar} session={session} />}
            key={avatar.id}
          >
            <Character
              avatar={avatar}
              modelBaseUrl={characterModelBaseUrl}
              modelUrl={sahurModelUrl}
              session={session}
            />
          </Suspense>
        )
      )}

      <CameraRig coarsePointer={stableTvCompositing} exposeFitDebug={exposeFitDebug} session={session} />
    </Canvas>
  );
}

const PERFORMANCE_WARMUP_FRAMES = 15;
const PERFORMANCE_REPORT_INTERVAL = 15;
const FRAME_TIME_CAVEAT =
  "Frame time is the requestAnimationFrame interval, not a disjoint GPU timer.";
const MEMORY_PROXY_CAVEAT =
  "GPU memory is a lower-bound proxy; driver padding, shader binaries, multisample resolves and compositor memory are excluded.";

function StagePerformanceProbe({
  coarsePointer,
  onDiagnostics,
  quality
}: Readonly<{
  coarsePointer: boolean;
  onDiagnostics(diagnostics: JugarStageDiagnostics): void;
  quality: JugarStageQuality;
}>) {
  const { gl, scene } = useThree();
  const monitor = useMemo(() => new JugarStagePerformanceMonitor(quality), [quality]);
  const environment = useMemo(() => rendererEnvironment(gl), [gl]);
  const frameRef = useRef(0);
  const memoryRef = useRef<JugarStageMemoryProxy>(emptyMemoryProxy());
  const drawingBufferSizeRef = useRef(new THREE.Vector2());

  useEffect(() => {
    frameRef.current = 0;
    memoryRef.current = emptyMemoryProxy();
  }, [monitor]);

  useFrame((_, delta) => {
    frameRef.current += 1;
    if (frameRef.current <= PERFORMANCE_WARMUP_FRAMES || !Number.isFinite(delta) || delta < 0) return;
    const sampleNumber = frameRef.current - PERFORMANCE_WARMUP_FRAMES;
    if (sampleNumber === 1 || sampleNumber % PERFORMANCE_REPORT_INTERVAL === 0) {
      const drawingBuffer = gl.getDrawingBufferSize(drawingBufferSizeRef.current);
      memoryRef.current = estimateJugarStageMemoryProxy(scene, {
        drawingBufferWidth: drawingBuffer.x,
        drawingBufferHeight: drawingBuffer.y,
        shadowMapSize: stageShadowMapSize(quality, coarsePointer)
      });
    }
    const memory = memoryRef.current;
    monitor.record({
      frameMillis: delta * 1_000,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
      geometryMemoryProxyMegabytes: bytesToMegabytes(memory.geometryBytes),
      textureMemoryProxyMegabytes: bytesToMegabytes(memory.textureBytes),
      framebufferMemoryProxyMegabytes: bytesToMegabytes(memory.framebufferBytes),
      shadowMemoryProxyMegabytes: bytesToMegabytes(memory.shadowBytes),
      gpuMemoryProxyMegabytes: bytesToMegabytes(memory.totalBytes)
    });
    if (sampleNumber % PERFORMANCE_REPORT_INTERVAL !== 0) return;
    const softwareCaveat = environment.softwareRenderer
      ? "Software/headless WebGL detected; timing is a CI regression signal, not venue-hardware certification."
      : undefined;
    onDiagnostics(monitor.report({
      environment,
      caveats: [FRAME_TIME_CAVEAT, MEMORY_PROXY_CAVEAT, ...(softwareCaveat ? [softwareCaveat] : [])]
    }));
  });

  return null;
}

function stageShadowMapSize(quality: JugarStageQuality, coarsePointer: boolean): number {
  if (quality === "mobile-low") return 0;
  if (quality === "venue-high" || quality === "capture") return 2_048;
  return coarsePointer ? 512 : 1_024;
}

function rendererEnvironment(gl: THREE.WebGLRenderer): JugarStageRendererEnvironment {
  const context = gl.getContext();
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info") as {
    UNMASKED_RENDERER_WEBGL: number;
    UNMASKED_VENDOR_WEBGL: number;
  } | null;
  const renderer = String(context.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER));
  const vendor = String(context.getParameter(debugInfo?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR));
  return Object.freeze({
    vendor,
    renderer,
    softwareRenderer: /swiftshader|llvmpipe|software rasterizer/iu.test(`${vendor} ${renderer}`)
  });
}

function emptyMemoryProxy(): JugarStageMemoryProxy {
  return Object.freeze({ geometryBytes: 0, textureBytes: 0, framebufferBytes: 0, shadowBytes: 0, totalBytes: 0 });
}

function SessionDebugOverlay({
  debug,
  session
}: Readonly<{ debug: JugarStageDebugOptions; session: GameSession }>) {
  return session.agentDebug
    .filter((entry) => debug.selectedAvatarId === undefined || entry.avatarId === debug.selectedAvatarId)
    .map((entry) => {
      const avatar = session.avatars.find((candidate) => candidate.id === entry.avatarId);
      const color = avatar?.color ?? "#23d5ff";
      const points = entry.path.map((point) => {
        const world = tileToWorld(point.x, point.y);
        return [world.x, TILE_TOP_Y + 0.045, world.z] as [number, number, number];
      });
      const target = entry.target ? tileToWorld(entry.target.x, entry.target.y) : undefined;
      return (
        <group key={entry.avatarId}>
          {debug.paths && points.length >= 2 ? (
            <Line color={color} depthTest={false} lineWidth={2} points={points} transparent />
          ) : null}
          {debug.targets && target ? (
            <mesh position={[target.x, TILE_TOP_Y + 0.055, target.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.16, 0.22, 24]} />
              <meshBasicMaterial color={color} depthTest={false} toneMapped={false} transparent />
            </mesh>
          ) : null}
        </group>
      );
    });
}

/** Point the camera looks at: between the board center and the TV. */
const LOOK_AT = new THREE.Vector3(0, 1.1, -1.6);
/** Camera sits behind and above the near edge of the floor. */
const VIEW_DIRECTION = new THREE.Vector3(0, 0.66, 1).normalize();
/**
 * Fractions of the viewport the framed content may occupy. Vertical is nearly
 * everything — the game should run edge to edge — while landscape keeps side
 * room, which is where the HUD lives. Portrait has no spare sides.
 */
const FIT_MARGIN_Y = 0.985;
const FIT_MARGIN_X_LANDSCAPE = 0.9;
const FIT_MARGIN_X_PORTRAIT = 0.97;
/** Room left for the pointer-parallax drift, in world units. */
const PARALLAX_X = 0.35;
const PARALLAX_Y = 0.2;

/**
 * Every corner that must stay on screen: the full 16x32 board plus the TV.
 * Fitting against these guarantees the whole board is visible at any aspect
 * ratio, on phones included.
 */
const FRAMED_POINTS: THREE.Vector3[] = (() => {
  const halfWidth = FLOOR_WORLD_WIDTH / 2;
  const halfDepth = FLOOR_WORLD_DEPTH / 2;
  const points: THREE.Vector3[] = [];
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      // Floor plane, plus head height so robots never clip the top edge.
      points.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1.5, z));
    }
  }
  for (const x of [TV_BOUNDS.minX, TV_BOUNDS.maxX]) {
    for (const y of [TV_BOUNDS.minY, TV_BOUNDS.maxY]) {
      points.push(new THREE.Vector3(x, y, TV_BOUNDS.z));
    }
  }
  return points;
})();

/**
 * Frames the whole board (and the TV) for the current viewport, then adds a
 * gentle pointer parallax that stays inside the fitted margin.
 */
function CameraRig({
  coarsePointer,
  exposeFitDebug,
  session
}: Readonly<{ coarsePointer: boolean; exposeFitDebug: boolean; session: GameSession }>) {
  const { camera, size } = useThree();
  const pointer = useRef({ x: 0, y: 0 });
  // Mutable camera scratch space lives in refs (lazily created): the fit
  // effect and the frame loop both write into these vectors.
  const vectorsRef = useRef<{
    basePosition: THREE.Vector3;
    scratch: THREE.Vector3;
    lookTarget: THREE.Vector3;
  } | null>(null);
  if (vectorsRef.current === null) {
    vectorsRef.current = {
      basePosition: new THREE.Vector3(),
      scratch: new THREE.Vector3(),
      // The fitted view centre: starts at LOOK_AT, nudged vertically so the
      // content fills the frame symmetrically (see the recentre loop below).
      lookTarget: new THREE.Vector3().copy(LOOK_AT)
    };
  }

  useEffect(() => {
    // No parallax on touch: dragging fires pointermove, and the camera drift
    // makes the DOM-composited TV lag a frame behind the canvas — visible as
    // flicker. A static camera keeps both layers locked together.
    if (coarsePointer) {
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      pointer.current = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: (event.clientY / window.innerHeight) * 2 - 1
      };
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [coarsePointer]);

  // Re-fit whenever the viewport (and therefore the aspect ratio) changes.
  useEffect(() => {
    let exposedFit: Record<string, unknown> | undefined;
    const { basePosition, lookTarget } = vectorsRef.current!;
    const perspective = camera as THREE.PerspectiveCamera;
    const marginX = size.width >= size.height ? FIT_MARGIN_X_LANDSCAPE : FIT_MARGIN_X_PORTRAIT;
    const probe = new THREE.Vector3();
    lookTarget.copy(LOOK_AT);

    // Fit, then recentre: fitting alone stops when ONE vertical extreme hits
    // its margin, leaving the opposite edge with dead space. Nudging the view
    // centre by the NDC midpoint and refitting shares the margin between top
    // and bottom, which is what lets the scene run edge to edge.
    let distance = 20;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      distance = fitDistance(
        perspective,
        lookTarget,
        VIEW_DIRECTION,
        FRAMED_POINTS,
        marginX,
        FIT_MARGIN_Y,
        coarsePointer
      );
      perspective.position.copy(lookTarget).addScaledVector(VIEW_DIRECTION, distance);
      perspective.lookAt(lookTarget);
      perspective.updateMatrixWorld(true);
      perspective.updateProjectionMatrix();

      let minY = 1;
      let maxY = -1;
      for (const point of FRAMED_POINTS) {
        probe.copy(point).project(perspective);
        minY = Math.min(minY, probe.y);
        maxY = Math.max(maxY, probe.y);
      }
      const midY = (minY + maxY) / 2;
      if (Math.abs(midY) < 0.004) {
        break;
      }
      lookTarget.y += midY * Math.tan((perspective.fov * Math.PI) / 360) * distance;
    }

    basePosition.copy(lookTarget).addScaledVector(VIEW_DIRECTION, distance);
    perspective.position.copy(basePosition);
    perspective.lookAt(lookTarget);
    perspective.updateProjectionMatrix();

    if (exposeFitDebug && typeof window !== "undefined") {
      perspective.updateMatrixWorld(true);
      let minX = 1, maxX = -1, minY = 1, maxY = -1;
      for (const point of FRAMED_POINTS) {
        probe.copy(point).project(perspective);
        minX = Math.min(minX, probe.x); maxX = Math.max(maxX, probe.x);
        minY = Math.min(minY, probe.y); maxY = Math.max(maxY, probe.y);
      }
      exposedFit = {
        distance, marginX, ndc: { minX, maxX, minY, maxY }, aspect: perspective.aspect, size: [size.width, size.height]
      };
      (window as unknown as Record<string, unknown>)["__jugar3dFit"] = exposedFit;
    }
    return () => {
      if (typeof window === "undefined" || !exposedFit) return;
      const globals = window as unknown as Record<string, unknown>;
      if (globals["__jugar3dFit"] === exposedFit) delete globals["__jugar3dFit"];
    };
  }, [camera, coarsePointer, exposeFitDebug, size.height, size.width]);

  useFrame((_, delta) => {
    const { basePosition, scratch, lookTarget } = vectorsRef.current!;
    scratch.set(
      basePosition.x + pointer.current.x * PARALLAX_X,
      basePosition.y - pointer.current.y * PARALLAX_Y,
      basePosition.z
    );
    if (session.isPresentingTrajectory) {
      // A replay seek is a complete presentation sample, not a continuation
      // of whichever camera easing history happened to precede it.
      camera.position.copy(scratch);
    } else {
      const damp = 1 - Math.exp(-delta * 3.2);
      camera.position.lerp(scratch, damp);
    }
    camera.lookAt(lookTarget);
  });

  return null;
}

/**
 * Smallest distance along `direction` at which every point projects inside the
 * viewport (scaled by FIT_MARGIN). NDC overflow scales roughly linearly with
 * distance, so scaling by the overflow converges in a handful of passes.
 */
function fitDistance(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  direction: THREE.Vector3,
  points: THREE.Vector3[],
  marginX: number,
  marginY: number,
  coarsePointer: boolean
): number {
  const probe = new THREE.Vector3();
  let distance = 20;

  for (let pass = 0; pass < 16; pass += 1) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.updateProjectionMatrix();

    let overflow = 0;
    for (const point of points) {
      probe.copy(point).project(camera);
      overflow = Math.max(overflow, Math.abs(probe.x) / marginX, Math.abs(probe.y) / marginY);
    }

    if (overflow === 0 || Math.abs(overflow - 1) < 0.005) {
      break;
    }
    distance *= overflow;
  }

  // Touch has no parallax, so it needs no drift reserve — only the tiny
  // convergence slack. Every wasted unit here is empty screen.
  return coarsePointer
    ? distance * 1.005
    : distance * 1.01 + Math.max(PARALLAX_X, PARALLAX_Y) * 0.5;
}
