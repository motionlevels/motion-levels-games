"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { CharacterProps } from "./types.ts";
import {
  FOOT_Y,
  HIP_Y,
  LEG_GROUP_Y,
  faceKeyLightAtCamera,
  updateContactRing,
  useCharacterMotion
} from "./motion.ts";

/**
 * A small stylized robot. Procedural rig: walk cycle, jump squash & stretch,
 * idle sway, victory bounce and defeat slump all come from the shared motion
 * driver, which reads the live session.
 */
export function Robot({ session, avatar }: CharacterProps) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const keyLightRef = useRef<THREE.PointLight>(null);

  const accent = useMemo(() => new THREE.Color(avatar.color), [avatar.color]);
  // Bright chassis so the character reads clearly against a fully lit floor.
  const shell = avatar.isBot ? "#8d9aa6" : "#e8eff5";
  const joint = avatar.isBot ? "#4a555f" : "#5d6a76";

  useCharacterMotion(session, avatar, rootRef, (pose) => {
    const { time, stride, motion, jumpPose, jumping, celebrating, defeated, moving } = pose;

    if (bodyRef.current) {
      bodyRef.current.rotation.x = motion * 0.14 - jumpPose * 0.12 + (defeated ? 0.32 : 0);
      bodyRef.current.rotation.z = -stride * 0.05;
      bodyRef.current.position.y = HIP_Y + Math.sin(time * 2.1 + avatar.id * 1.3) * 0.012;
    }
    if (headRef.current) {
      headRef.current.rotation.y = moving ? -stride * 0.14 : Math.sin(time * 1.2 + avatar.id) * 0.2;
      headRef.current.rotation.x = defeated ? 0.4 : celebrating ? -0.18 : 0;
    }
    if (leftArmRef.current && rightArmRef.current) {
      const raise = celebrating ? 2.6 : jumpPose * 2.3;
      leftArmRef.current.rotation.x = stride * 0.95;
      rightArmRef.current.rotation.x = -stride * 0.95;
      leftArmRef.current.rotation.z = -raise;
      rightArmRef.current.rotation.z = raise;
    }
    if (leftLegRef.current && rightLegRef.current) {
      leftLegRef.current.rotation.x = -stride * 0.85 + jumpPose * 0.5;
      rightLegRef.current.rotation.x = stride * 0.85 + jumpPose * 0.5;
    }
    faceKeyLightAtCamera(keyLightRef.current, rootRef.current);
    updateContactRing(ringRef.current, jumping);
  });

  return (
    <group ref={rootRef} scale={1.02}>
      {/* Thin contact ring, hugging the panel the robot stands on. Kept small
          and dim so it marks the player without masking the LED colors. */}
      <mesh position={[0, 0.004, 0]} ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.19, 0.22, 28]} />
        <meshBasicMaterial
          color={accent}
          depthWrite={false}
          opacity={0.3}
          toneMapped={false}
          transparent
        />
      </mesh>

      {/* Key light travelling with the character so it never sinks into a
          brightly lit floor. Only the player carries one, to keep cost low. */}
      {avatar.isBot ? null : (
        <pointLight
          color="#eaf6ff"
          distance={3.6}
          intensity={9}
          position={[0, 1.6, 1]}
          ref={keyLightRef}
        />
      )}

      <group position={[0, HIP_Y, 0]} ref={bodyRef}>
        {/* Torso */}
        <mesh castShadow>
          <capsuleGeometry args={[0.17, 0.3, 6, 14]} />
          <meshStandardMaterial color={shell} metalness={0.55} roughness={0.3} />
        </mesh>
        {/* Chest core */}
        <mesh position={[0, 0.05, 0.15]}>
          <cylinderGeometry args={[0.055, 0.055, 0.045, 18]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={1.6}
            metalness={0.2}
            roughness={0.3}
          />
        </mesh>
        {/* Belt light */}
        <mesh position={[0, -0.14, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.155, 0.018, 10, 26]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} />
        </mesh>

        {/* Head */}
        <group position={[0, 0.42, 0]} ref={headRef}>
          <mesh castShadow>
            <sphereGeometry args={[0.155, 22, 18]} />
            <meshStandardMaterial color={shell} metalness={0.6} roughness={0.26} />
          </mesh>
          {/* Visor */}
          <mesh position={[0, 0.015, 0.105]} rotation={[-0.08, 0, 0]}>
            <capsuleGeometry args={[0.052, 0.1, 4, 12]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={2.1}
              metalness={0.1}
              roughness={0.2}
            />
          </mesh>
          {/* Antenna */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.011, 0.011, 0.1, 8]} />
            <meshStandardMaterial color={joint} metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.27, 0]}>
            <sphereGeometry args={[0.027, 12, 10]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={2.4} />
          </mesh>
          {/* Ear pods */}
          <mesh position={[-0.155, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.045, 0.045, 0.03, 14]} />
            <meshStandardMaterial color={joint} metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0.155, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.045, 0.045, 0.03, 14]} />
            <meshStandardMaterial color={joint} metalness={0.7} roughness={0.3} />
          </mesh>
        </group>

        {/* Arms */}
        <group position={[-0.235, 0.14, 0]} ref={leftArmRef}>
          <mesh castShadow position={[0, -0.13, 0]}>
            <capsuleGeometry args={[0.05, 0.2, 4, 10]} />
            <meshStandardMaterial color={joint} metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh position={[0, -0.27, 0]}>
            <sphereGeometry args={[0.06, 12, 10]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
          </mesh>
        </group>
        <group position={[0.235, 0.14, 0]} ref={rightArmRef}>
          <mesh castShadow position={[0, -0.13, 0]}>
            <capsuleGeometry args={[0.05, 0.2, 4, 10]} />
            <meshStandardMaterial color={joint} metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh position={[0, -0.27, 0]}>
            <sphereGeometry args={[0.06, 12, 10]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
          </mesh>
        </group>

        {/* Legs */}
        <group position={[-0.09, LEG_GROUP_Y, 0]} ref={leftLegRef}>
          <mesh castShadow position={[0, -0.14, 0]}>
            <capsuleGeometry args={[0.055, 0.18, 4, 10]} />
            <meshStandardMaterial color={joint} metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh castShadow position={[0, FOOT_Y, 0.03]}>
            <boxGeometry args={[0.11, 0.06, 0.17]} />
            <meshStandardMaterial color={shell} metalness={0.55} roughness={0.3} />
          </mesh>
        </group>
        <group position={[0.09, LEG_GROUP_Y, 0]} ref={rightLegRef}>
          <mesh castShadow position={[0, -0.14, 0]}>
            <capsuleGeometry args={[0.055, 0.18, 4, 10]} />
            <meshStandardMaterial color={joint} metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh castShadow position={[0, FOOT_Y, 0.03]}>
            <boxGeometry args={[0.11, 0.06, 0.17]} />
            <meshStandardMaterial color={shell} metalness={0.55} roughness={0.3} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
