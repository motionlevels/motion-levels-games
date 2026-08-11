"use client";

import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  motionAthleteCast,
  type CharacterArchetype
} from "@motion-levels-games/character-runtime";

import type { CharacterProps } from "./types.ts";
import {
  FOOT_Y,
  HIP_Y,
  LEG_GROUP_Y,
  animationClipWeight,
  faceKeyLightAtCamera,
  updateContactRing,
  useCharacterMotion
} from "./motion.ts";

/** Canonical procedural Motion Athlete; `Robot` remains the compatibility name. */
export function Robot({
  session,
  avatar,
  variantId
}: CharacterProps & { variantId?: CharacterArchetype }) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftForearmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftFootRef = useRef<THREE.Group>(null);
  const rightFootRef = useRef<THREE.Group>(null);
  const visorRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const keyLightRef = useRef<THREE.PointLight>(null);

  const variant = motionAthleteCast.find((candidate) => candidate.id === variantId)
    ?? motionAthleteCast[avatar.id % motionAthleteCast.length]
    ?? motionAthleteCast[0]!;
  const accent = useMemo(() => new THREE.Color(avatar.color), [avatar.color]);
  const shell = useMemo(
    () => avatar.isBot ? dimColor(variant.palette.primary, 0.68) : variant.palette.primary,
    [avatar.isBot, variant.palette.primary]
  );
  const joint = useMemo(
    () => avatar.isBot ? dimColor(variant.palette.secondary, 0.68) : variant.palette.secondary,
    [avatar.isBot, variant.palette.secondary]
  );
  const visor = variant.palette.emissive;

  useCharacterMotion(session, avatar, rootRef, (pose) => {
    const {
      time,
      stride,
      motion,
      jumpPose,
      jumping,
      landing,
      hit,
      celebrating,
      defeated,
      moving,
      animationGraph,
      procedural
    } = pose;
    const run = animationClipWeight(animationGraph.locomotion, "run");
    const stop = animationClipWeight(animationGraph.locomotion, "stop-recover");
    const turn = animationClipWeight(animationGraph.locomotion, "turn-left")
      - animationClipWeight(animationGraph.locomotion, "turn-right");
    const celebrate = Math.max(
      animationClipWeight(animationGraph.fullBody, "celebrate-team"),
      animationClipWeight(animationGraph.fullBody, "celebrate-large"),
      animationClipWeight(animationGraph.upperBody, "celebrate-small")
    );
    const strideAmount = 0.78 + run * 0.32;

    if (bodyRef.current) {
      bodyRef.current.rotation.x = procedural.bodyLeanY * 0.55 + motion * 0.07
        - jumpPose * 0.12 + hit * 0.13 + (defeated ? 0.32 : 0);
      bodyRef.current.rotation.z = -stride * 0.045 - procedural.bodyLeanX * 0.35 + hit * 0.07;
      bodyRef.current.position.y = HIP_Y
        + Math.sin(time * 1.65 + avatar.id * 1.3) * 0.012 * procedural.breathingWeight
        - landing * 0.045;
    }
    if (headRef.current) {
      const idleGlance = moving ? 0 : Math.sin(time * 0.72 + avatar.id * 2.1) * 0.08;
      headRef.current.rotation.y = procedural.headYawRadians * 0.72 + idleGlance + turn * 0.18;
      headRef.current.rotation.x = defeated
        ? 0.4
        : celebrating
          ? -0.18
          : procedural.headPitchRadians + hit * 0.06;
    }
    if (visorRef.current) visorRef.current.scale.y = 1 - procedural.blink * 0.82;
    if (leftArmRef.current && rightArmRef.current) {
      const raise = Math.max(celebrating ? 1 : 0, celebrate) * 2.6 + jumpPose * 1.85;
      leftArmRef.current.rotation.x = stride * strideAmount + hit * 0.3;
      rightArmRef.current.rotation.x = -stride * strideAmount - hit * 0.18;
      leftArmRef.current.rotation.z = -raise;
      rightArmRef.current.rotation.z = raise;
    }
    if (leftForearmRef.current && rightForearmRef.current) {
      const elbow = Math.abs(stride) * (0.22 + run * 0.26) + stop * 0.2;
      leftForearmRef.current.rotation.x = -elbow - hit * 0.18;
      rightForearmRef.current.rotation.x = -elbow - hit * 0.1;
    }
    if (leftLegRef.current && rightLegRef.current) {
      leftLegRef.current.rotation.x = -stride * strideAmount + jumpPose * 0.5 + landing * 0.2;
      rightLegRef.current.rotation.x = stride * strideAmount + jumpPose * 0.5 + landing * 0.2;
    }
    if (leftFootRef.current && rightFootRef.current) {
      leftFootRef.current.rotation.x = stride > 0 ? -stride * 0.38 : -stride * 0.12;
      rightFootRef.current.rotation.x = stride < 0 ? stride * 0.38 : stride * 0.12;
    }
    faceKeyLightAtCamera(keyLightRef.current, rootRef.current);
    updateContactRing(ringRef.current, jumping, landing, hit);
  });

  return (
    <group ref={rootRef} scale={1.02}>
      <mesh position={[0, 0.004, 0]} ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.19, 0.22, 28]} />
        <meshBasicMaterial color={accent} depthWrite={false} opacity={0.3} toneMapped={false} transparent />
      </mesh>

      {avatar.isBot ? null : (
        <pointLight color="#eaf6ff" distance={3.6} intensity={9} position={[0, 1.6, 1]} ref={keyLightRef} />
      )}

      <group position={[0, HIP_Y, 0]} ref={bodyRef}>
        <mesh
          castShadow
          scale={variant.id === "guardian"
            ? [1.14, 1, 1]
            : variant.id === "runner"
              ? [0.9, 1.04, 0.92]
              : 1}
        >
          <capsuleGeometry args={[0.17, 0.3, 6, 14]} />
          <meshStandardMaterial color={shell} metalness={0.55} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.05, 0.15]}>
          <cylinderGeometry args={[0.055, 0.055, 0.045, 18]} />
          <meshStandardMaterial color={visor} emissive={visor} emissiveIntensity={1.8} metalness={0.2} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.14, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.155, 0.018, 10, 26]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} />
        </mesh>

        <group position={[0, 0.42, 0]} ref={headRef}>
          <mesh castShadow>
            <sphereGeometry args={[0.17, 22, 18]} />
            <meshStandardMaterial color={shell} metalness={0.6} roughness={0.26} />
          </mesh>
          <mesh position={[0, 0.015, 0.118]} ref={visorRef} rotation={[-0.08, 0, 0]}>
            <capsuleGeometry args={[0.056, 0.112, 4, 12]} />
            <meshStandardMaterial color={visor} emissive={visor} emissiveIntensity={2.3} metalness={0.1} roughness={0.2} />
          </mesh>
          <mesh
            position={variant.id === "trickster" ? [0.045, 0.2, 0] : [0, 0.2, 0]}
            rotation={variant.id === "trickster" ? [0, 0, -0.38] : [0, 0, 0]}
          >
            <cylinderGeometry args={[0.011, 0.011, 0.1, 8]} />
            <meshStandardMaterial color={joint} metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={variant.id === "trickster" ? [0.085, 0.265, 0] : [0, 0.27, 0]}>
            <sphereGeometry args={[0.027, 12, 10]} />
            <meshStandardMaterial color={visor} emissive={visor} emissiveIntensity={2.4} />
          </mesh>
        </group>

        <Arm accent={accent} joint={joint} position={[-0.235, 0.14, 0]} refSet={{ upper: leftArmRef, lower: leftForearmRef }} />
        <Arm accent={accent} joint={joint} position={[0.235, 0.14, 0]} refSet={{ upper: rightArmRef, lower: rightForearmRef }} />
        <VariantAccessory accent={accent} joint={joint} shell={shell} variant={variant.id} />

        <Leg joint={joint} position={[-0.09, LEG_GROUP_Y, 0]} refSet={{ upper: leftLegRef, foot: leftFootRef }} shell={shell} />
        <Leg joint={joint} position={[0.09, LEG_GROUP_Y, 0]} refSet={{ upper: rightLegRef, foot: rightFootRef }} shell={shell} />
      </group>
    </group>
  );
}

export function Explorer(props: CharacterProps) {
  return <Robot {...props} variantId="explorer" />;
}

export function Runner(props: CharacterProps) {
  return <Robot {...props} variantId="runner" />;
}

export function Trickster(props: CharacterProps) {
  return <Robot {...props} variantId="trickster" />;
}

export function Guardian(props: CharacterProps) {
  return <Robot {...props} variantId="guardian" />;
}

type GroupRef = RefObject<THREE.Group | null>;

function Arm({
  accent,
  joint,
  position,
  refSet
}: Readonly<{
  accent: THREE.Color;
  joint: string;
  position: [number, number, number];
  refSet: { upper: GroupRef; lower: GroupRef };
}>) {
  return (
    <group position={position} ref={refSet.upper}>
      <mesh castShadow position={[0, -0.09, 0]}><capsuleGeometry args={[0.05, 0.12, 4, 10]} /><meshStandardMaterial color={joint} metalness={0.5} roughness={0.35} /></mesh>
      <group position={[0, -0.18, 0]} ref={refSet.lower}>
        <mesh position={[0, -0.13, 0.015]}><sphereGeometry args={[0.064, 12, 10]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} /></mesh>
      </group>
    </group>
  );
}

function Leg({
  joint,
  position,
  refSet,
  shell
}: Readonly<{
  joint: string;
  position: [number, number, number];
  refSet: { upper: GroupRef; foot: GroupRef };
  shell: string;
}>) {
  return (
    <group position={position} ref={refSet.upper}>
      <mesh castShadow position={[0, -0.14, 0]}><capsuleGeometry args={[0.055, 0.18, 4, 10]} /><meshStandardMaterial color={joint} metalness={0.5} roughness={0.35} /></mesh>
      <group position={[0, FOOT_Y, 0.03]} ref={refSet.foot}>
        <mesh castShadow><boxGeometry args={[0.12, 0.065, 0.19]} /><meshStandardMaterial color={shell} metalness={0.55} roughness={0.3} /></mesh>
      </group>
    </group>
  );
}

function VariantAccessory({
  accent,
  joint,
  shell,
  variant
}: Readonly<{ accent: THREE.Color; joint: string; shell: string; variant: CharacterArchetype }>) {
  if (variant === "explorer") {
    return <mesh castShadow position={[0, 0.07, -0.2]}><boxGeometry args={[0.22, 0.27, 0.1]} /><meshStandardMaterial color={joint} metalness={0.5} roughness={0.38} /></mesh>;
  }
  if (variant === "runner") {
    return <mesh position={[0, -0.08, -0.18]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.14, 0.013, 8, 22]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} /></mesh>;
  }
  if (variant === "guardian") {
    return (
      <group position={[0, 0.17, 0]}>
        <mesh castShadow position={[-0.23, 0, 0]} rotation={[0, 0, 0.22]}><boxGeometry args={[0.13, 0.08, 0.18]} /><meshStandardMaterial color={shell} metalness={0.6} roughness={0.28} /></mesh>
        <mesh castShadow position={[0.23, 0, 0]} rotation={[0, 0, -0.22]}><boxGeometry args={[0.13, 0.08, 0.18]} /><meshStandardMaterial color={shell} metalness={0.6} roughness={0.28} /></mesh>
      </group>
    );
  }
  return <mesh position={[-0.25, -0.07, 0.02]}><sphereGeometry args={[0.04, 10, 8]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.7} /></mesh>;
}

function dimColor(color: string, factor: number): string {
  return `#${new THREE.Color(color).multiplyScalar(factor).getHexString()}`;
}
