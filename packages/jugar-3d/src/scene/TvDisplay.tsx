"use client";

import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import { Html } from "@react-three/drei";
import { memo, useEffect, useReducer } from "react";

import type { GameSession } from "../core/session.ts";
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
export function TvDisplay({ session }: { session: GameSession }) {
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

      <Html
        occlude={false}
        position={[0, 0, 0.02]}
        scale={SCREEN_SCALE}
        transform
        wrapperClass="mlg-tv-screen"
        zIndexRange={[5, 0]}
      >
        <div
          style={{
            width: NATIVE_WIDTH,
            height: NATIVE_HEIGHT,
            overflow: "hidden",
            background: "#02060a",
            pointerEvents: "none",
            userSelect: "none"
          }}
        >
          <TvContent session={session} />
        </div>
      </Html>
    </group>
  );
}

/** Subscribes to the session so only the TV DOM re-renders at display rate. */
const TvContent = memo(function TvContent({ session }: { session: GameSession }) {
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
