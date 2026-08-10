"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { FLOOR_WORLD_DEPTH, FLOOR_WORLD_WIDTH } from "../core/tileMath.ts";

/**
 * Static venue dressing around the floor: dark hall, neon pillars and a
 * subtle fog of light so the LED floor and TV feel like they are in the room.
 */
export function Arena() {
  const pillars = useMemo(() => {
    const positions: Array<[number, number, number, string]> = [];
    const halfW = FLOOR_WORLD_WIDTH / 2 + 1.7;
    const halfD = FLOOR_WORLD_DEPTH / 2 + 1.2;
    const colors = ["#23d5ff", "#b8ff00", "#ff5c8a", "#23d5ff"];
    [
      [-halfW, -halfD * 0.55],
      [halfW, -halfD * 0.55],
      [-halfW, halfD * 0.4],
      [halfW, halfD * 0.4]
    ].forEach(([x, z], index) => {
      positions.push([x!, 1.5, z!, colors[index % colors.length]!]);
    });
    return positions;
  }, []);

  return (
    <group>
      {/* Hall floor */}
      <mesh position={[0, -0.32, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[70, 70]} />
        <meshStandardMaterial color="#05080b" metalness={0.35} roughness={0.75} />
      </mesh>

      {/* Back wall behind the TV */}
      <mesh position={[0, 4.2, -FLOOR_WORLD_DEPTH / 2 - 1.6]}>
        <planeGeometry args={[46, 14]} />
        <meshStandardMaterial color="#060a0e" metalness={0.25} roughness={0.85} />
      </mesh>

      {/* Neon strip along the wall */}
      <mesh position={[0, 0.35, -FLOOR_WORLD_DEPTH / 2 - 1.55]}>
        <boxGeometry args={[22, 0.06, 0.06]} />
        <meshBasicMaterial color="#23d5ff" toneMapped={false} />
      </mesh>

      {pillars.map(([x, y, z, color], index) => (
        <group key={index} position={[x, y, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.09, 0.12, 3.6, 12]} />
            <meshStandardMaterial color="#0b1116" metalness={0.65} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.5, 12]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
          <pointLight color={color} distance={7.5} intensity={4.5} position={[0, 0.9, 0]} />
        </group>
      ))}

      {/* Faint haze plane above the floor */}
      <mesh position={[0, 2.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FLOOR_WORLD_WIDTH + 6, FLOOR_WORLD_DEPTH + 6]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#0a2a33"
          depthWrite={false}
          opacity={0.05}
          transparent
        />
      </mesh>
    </group>
  );
}
