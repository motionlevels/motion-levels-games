"use client";

import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { memo, useEffect, useReducer, useRef } from "react";
import * as THREE from "three";

import type { JugarPresentationSession } from "../core/session.ts";
import { FLOOR_WORLD_DEPTH } from "../core/tileMath.ts";

const NATIVE_WIDTH = 1920;
const NATIVE_HEIGHT = 1080;
/** World width of the TV screen, in three.js units. */
const SCREEN_WIDTH = 8.6;
const SCREEN_HEIGHT = (SCREEN_WIDTH * 9) / 16;
const SCREEN_CENTER_Y = 3.1;
const WALL_Z = -FLOOR_WORLD_DEPTH / 2 - 1.35;

/**
 * drei's <Html transform> lays the element out in a CSS 3D space fixed at
 * 40px per world unit (it divides by `(distanceFactor || 10) / 400`), so an
 * element of N css pixels spans N * scale / 40 world units.
 */
const HTML_TRANSFORM_PX_PER_UNIT = 40;
const SCREEN_SCALE = (SCREEN_WIDTH * HTML_TRANSFORM_PX_PER_UNIT) / NATIVE_WIDTH;

/** Screen extents, used by the camera rig to keep the TV framed. */
export const TV_BOUNDS = {
  minX: -SCREEN_WIDTH / 2,
  maxX: SCREEN_WIDTH / 2,
  minY: SCREEN_CENTER_Y - SCREEN_HEIGHT / 2,
  maxY: SCREEN_CENTER_Y + SCREEN_HEIGHT / 2,
  z: WALL_Z
};

/**
 * The venue TV: renders the game's real PlayerDisplay (the same React
 * component the venue player-display kiosk runs) onto a screen in the scene.
 */
export function TvDisplay({
  session,
  stableCompositing = false
}: {
  session: JugarPresentationSession;
  stableCompositing?: boolean;
}) {
  return (
    <group position={[0, SCREEN_CENTER_Y, WALL_Z]}>
      {/* TV body */}
      <mesh position={[0, 0, -0.09]}>
        <boxGeometry args={[SCREEN_WIDTH + 0.34, SCREEN_HEIGHT + 0.34, 0.16]} />
        <meshStandardMaterial color="#0a0f14" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Screen backing, so the panel reads as a screen before HTML paints */}
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[SCREEN_WIDTH, SCREEN_HEIGHT]} />
        <meshBasicMaterial color="#02060a" />
      </mesh>
      {/* Glow spill behind the TV */}
      <mesh position={[0, 0, -0.2]}>
        <planeGeometry args={[SCREEN_WIDTH + 2.6, SCREEN_HEIGHT + 2.2]} />
        <meshBasicMaterial color="#0b3d4a" depthWrite={false} opacity={0.24} transparent />
      </mesh>

      {stableCompositing ? (
        <StableTvSurface session={session} />
      ) : (
        <Html
          occlude={false}
          position={[0, 0, 0.02]}
          scale={SCREEN_SCALE}
          transform
          wrapperClass="mlg-tv-screen mlg-tv-screen--perspective"
          zIndexRange={[5, 0]}
        >
          <NativeTvContent session={session} />
        </Html>
      )}
    </group>
  );
}

const SCREEN_WORLD_Z = WALL_Z + 0.02;
const projectedPoint = new THREE.Vector3();
const projectedCenter = new THREE.Vector3();
const projectedCorners = [
  new THREE.Vector3(TV_BOUNDS.minX, TV_BOUNDS.minY, SCREEN_WORLD_Z),
  new THREE.Vector3(TV_BOUNDS.maxX, TV_BOUNDS.minY, SCREEN_WORLD_Z),
  new THREE.Vector3(TV_BOUNDS.minX, TV_BOUNDS.maxY, SCREEN_WORLD_Z),
  new THREE.Vector3(TV_BOUNDS.maxX, TV_BOUNDS.maxY, SCREEN_WORLD_Z)
] as const;

/**
 * Mobile Chrome can corrupt a frequently repainted 1920x1080 DOM subtree when
 * it sits inside Drei's per-frame CSS3D matrix chain over a WebGL canvas. This
 * path projects the TV bounds into ordinary screen-space CSS instead. The
 * mobile camera is static, so the layer remains aligned without compositor
 * churn while the live player display continues to update.
 */
function StableTvSurface({ session }: { session: JugarPresentationSession }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastLayoutRef = useRef("");
  const { camera, size } = useThree();

  useFrame(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    camera.updateMatrixWorld();
    projectedCenter
      .set(0, SCREEN_CENTER_Y, SCREEN_WORLD_Z)
      .project(camera);
    const centerX = (projectedCenter.x + 1) * size.width / 2;
    const centerY = (1 - projectedCenter.y) * size.height / 2;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const corner of projectedCorners) {
      projectedPoint.copy(corner).project(camera);
      const x = (projectedPoint.x + 1) * size.width / 2;
      const y = (1 - projectedPoint.y) * size.height / 2;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const left = minX - centerX;
    const top = minY - centerY;
    const layout = [left, top, width, height]
      .map((value) => value.toFixed(2))
      .join(":");
    if (layout === lastLayoutRef.current) return;
    lastLayoutRef.current = layout;

    surface.style.left = `${left}px`;
    surface.style.top = `${top}px`;
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    surface.style.setProperty("--mlg-tv-scale-x", String(width / NATIVE_WIDTH));
    surface.style.setProperty("--mlg-tv-scale-y", String(height / NATIVE_HEIGHT));
  });

  return (
    <Html
      occlude={false}
      position={[0, 0, 0.02]}
      transform={false}
      wrapperClass="mlg-tv-screen mlg-tv-screen--stable"
      zIndexRange={[5, 0]}
    >
      <div
        className="mlg-tv-stable-surface"
        data-compositing="stable-2d"
        ref={surfaceRef}
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          contain: "strict",
          isolation: "isolate",
          overflow: "hidden",
          background: "#02060a",
          pointerEvents: "none"
        }}
      >
        <NativeTvContent projected2d session={session} />
      </div>
    </Html>
  );
}

function NativeTvContent({
  session,
  projected2d = false
}: {
  session: JugarPresentationSession;
  projected2d?: boolean;
}) {
  return (
    <div
      className="mlg-tv-native-content"
      style={{
        width: NATIVE_WIDTH,
        height: NATIVE_HEIGHT,
        overflow: "hidden",
        background: "#02060a",
        pointerEvents: "none",
        userSelect: "none",
        ...(projected2d ? {
          transform: "scale(var(--mlg-tv-scale-x), var(--mlg-tv-scale-y))",
          transformOrigin: "0 0"
        } : {})
      }}
    >
      <TvContent session={session} />
    </div>
  );
}

/** Subscribes to the session so only the TV DOM re-renders at display rate. */
const TvContent = memo(function TvContent({ session }: { session: JugarPresentationSession }) {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => session.subscribe(bump), [session]);

  const { PlayerDisplay } = session.game;
  const state = session.state;

  return (
    <PlayerDisplayRuntimeProvider paused={session.paused}>
      <PlayerDisplay frame={state.frame} snapshot={state.snapshot} />
    </PlayerDisplayRuntimeProvider>
  );
});
