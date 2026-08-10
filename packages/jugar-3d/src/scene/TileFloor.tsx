"use client";

import { FLOOR_COLS, FLOOR_ROWS } from "@motion-levels-games/game-sdk";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { GameSession } from "../core/session.ts";
import {
  FLOOR_WORLD_DEPTH,
  FLOOR_WORLD_WIDTH,
  TILE_SIZE,
  TILE_TOP_Y,
  hexToRgb01,
  tileToWorld,
  worldToTile
} from "../core/tileMath.ts";

const TILE_COUNT = FLOOR_COLS * FLOOR_ROWS;
/** Fraction of a cell the lit panel covers; the remainder is the black seam. */
const PANEL_FRACTION = 0.9;
const PANEL_SIZE = TILE_SIZE * PANEL_FRACTION;
/**
 * Floor under an unlit panel. Just above black, so the panel grid stays
 * readable against the darker seams instead of disappearing into them.
 */
const MIN_TILE_CHANNEL = 0.04;

type Props = {
  session: GameSession;
  onTilePointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onTilePointerMove: (event: ThreeEvent<PointerEvent>) => void;
};

/**
 * The 16x32 LED floor: one unlit panel per tile, separated by thin black
 * seams, each panel showing exactly the color the running game rendered for
 * that tile. Panels are deliberately unlit (`meshBasicMaterial`, tone mapping
 * off) so scene lighting can never shift the game's colors.
 */
export function TileFloor({ session, onTilePointerDown, onTilePointerMove }: Props) {
  const tilesRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    const mesh = tilesRef.current;
    if (!mesh) {
      return;
    }
    for (let index = 0; index < TILE_COUNT; index += 1) {
      const x = index % FLOOR_COLS;
      const y = Math.floor(index / FLOOR_COLS);
      const world = tileToWorld(x, y);
      transform.position.set(world.x, TILE_TOP_Y, world.z);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.setRGB(0, 0, 0, THREE.SRGBColorSpace));
    }
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [color, transform]);

  useFrame(() => {
    const tiles = tilesRef.current;
    if (!tiles) {
      return;
    }
    for (const cell of session.state.frame.cells) {
      const rgb = hexToRgb01(cell.color);
      // The game's hex colors are sRGB; tagging them keeps each panel exactly
      // the shade the game intends instead of a washed-out linear reading.
      color.setRGB(
        Math.max(rgb.r, MIN_TILE_CHANNEL),
        Math.max(rgb.g, MIN_TILE_CHANNEL + 0.004),
        Math.max(rgb.b, MIN_TILE_CHANNEL + 0.008),
        THREE.SRGBColorSpace
      );
      tiles.setColorAt(cell.y * FLOOR_COLS + cell.x, color);
    }
    if (tiles.instanceColor) {
      tiles.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Chassis. Its face shows through the gaps as the seam between panels. */}
      <mesh position={[0, TILE_TOP_Y - 0.14, 0]} receiveShadow>
        <boxGeometry args={[FLOOR_WORLD_WIDTH + 0.6, 0.26, FLOOR_WORLD_DEPTH + 0.6]} />
        <meshStandardMaterial color="#010304" metalness={0.15} roughness={0.95} />
      </mesh>

      {/* Flat quads, not boxes: a box's lit side faces would visually close the
          seams at a grazing camera angle, smearing the grid into strips. */}
      <instancedMesh args={[undefined, undefined, TILE_COUNT]} ref={tilesRef}>
        <planeGeometry args={[PANEL_SIZE, PANEL_SIZE]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Invisible input plane covering the whole board */}
      <mesh
        onContextMenu={(event) => event.nativeEvent.preventDefault()}
        onPointerDown={onTilePointerDown}
        onPointerMove={onTilePointerMove}
        position={[0, TILE_TOP_Y + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <planeGeometry args={[FLOOR_WORLD_WIDTH, FLOOR_WORLD_DEPTH]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

export function pointToTile(point: THREE.Vector3) {
  return worldToTile(point.x, point.z);
}
