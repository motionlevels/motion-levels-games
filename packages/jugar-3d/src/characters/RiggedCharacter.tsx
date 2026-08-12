"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { CharacterProps } from "./types.ts";
import {
  animationClipWeight,
  faceKeyLightAtCamera,
  updateContactRing,
  useCharacterMotion
} from "./motion.ts";

export const RIGGED_CHARACTER_MODEL_BASE_URL = "/models/quaternius";

const TARGET_HEIGHT = 1.55;
const PLAYABLE_CLIPS = ["Idle_Neutral", "Walk", "Run", "Roll", "HitRecieve", "Death", "Wave", "Interact"] as const;

export function RiggedCharacter({
  assetId,
  session,
  avatar,
  modelBaseUrl = RIGGED_CHARACTER_MODEL_BASE_URL
}: CharacterProps & Readonly<{ assetId: string }>) {
  const rootRef = useRef<THREE.Group>(null);
  const poseRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const keyLightRef = useRef<THREE.PointLight>(null);
  const modelUrl = `${modelBaseUrl.replace(/\/$/u, "")}/${assetId}.glb`;
  const { scene, animations } = useGLTF(modelUrl);
  const model = useMemo(() => cloneSkinned(scene), [scene]);
  const accent = useMemo(() => new THREE.Color(avatar.color), [avatar.color]);
  const clips = useMemo(() => animations.map(makeInPlaceClip), [animations]);
  const { actions } = useAnimations(clips, modelRef);
  const actionRefs = useRef<Readonly<Record<string, THREE.AnimationAction | undefined>>>({});

  useEffect(() => {
    const selected = Object.fromEntries(
      PLAYABLE_CLIPS.map((name) => [name, actions[name]])
    ) as Readonly<Record<string, THREE.AnimationAction | undefined>>;
    actionRefs.current = selected;
    for (const action of Object.values(selected)) {
      if (!action) continue;
      action.reset().play();
      action.paused = true;
      action.setEffectiveWeight(0);
    }
    return () => {
      actionRefs.current = {};
      for (const action of Object.values(selected)) action?.stop();
    };
  }, [actions]);

  useEffect(() => {
    const ownedMaterials: THREE.Material[] = [];
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = !avatar.isBot;
      child.receiveShadow = false;
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const materials = sourceMaterials.map((source) => {
        const material = source.clone();
        ownedMaterials.push(material);
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = Math.max(0.48, material.roughness);
          material.envMapIntensity = 0.85;
          if (avatar.isBot) material.color.multiplyScalar(0.68);
        }
        return material;
      });
      child.material = Array.isArray(child.material) ? materials : materials[0]!;
    });
    return () => ownedMaterials.forEach((material) => material.dispose());
  }, [avatar.isBot, model]);

  useLayoutEffect(() => {
    const holder = modelRef.current;
    if (!holder) return;
    const fit = modelFit(scene);
    holder.scale.setScalar(fit.scale);
    holder.position.copy(fit.offset);
  }, [scene]);

  useCharacterMotion(session, avatar, rootRef, (pose) => {
    const fullBody = pose.animationGraph.fullBody;
    const upperBody = pose.animationGraph.upperBody;
    const hit = animationClipWeight(fullBody, "hit");
    const interaction = Math.max(
      animationClipWeight(upperBody, "interact"),
      animationClipWeight(upperBody, "point")
    );
    const authoredWave = Math.max(
      animationClipWeight(upperBody, "wave"),
      animationClipWeight(upperBody, "celebrate-small")
    );
    const roll = pose.jumping ? Math.min(1, pose.jumpPose * 1.7) : 0;
    const death = pose.defeated ? 1 : 0;
    const wave = pose.celebrating ? 1 : authoredWave;
    const override = Math.max(hit, interaction, roll, death, wave);
    const locomotion = pose.animationGraph.locomotion;
    const run = animationClipWeight(locomotion, "run");
    const walk = THREE.MathUtils.clamp(pose.motion - run, 0, 1);
    const base = 1 - override;

    setAction(actionRefs.current.Idle_Neutral, base * (1 - pose.motion), pose.time * 0.55);
    setAction(actionRefs.current.Walk, base * walk, avatar.distanceTravelled * 0.9);
    setAction(actionRefs.current.Run, base * run, avatar.distanceTravelled * 1.35);
    setActionPhase(actionRefs.current.Roll, roll * (1 - death), pose.jumpProgress * 0.96);
    setAction(actionRefs.current.HitRecieve, hit * (1 - death), (fullBody?.elapsedMillis ?? 0) / 1_000);
    setAction(actionRefs.current.Interact, interaction * (1 - death), (upperBody?.elapsedMillis ?? 0) / 1_000);
    setAction(actionRefs.current.Wave, wave * (1 - death), pose.time * 0.85);
    setActionPhase(actionRefs.current.Death, death, 0.98);

    const holder = poseRef.current;
    if (holder) {
      const idle = pose.motion < 0.2 ? pose.procedural.breathingWeight : 0;
      holder.position.y = Math.sin(pose.time * 1.5 + avatar.id) * 0.01 * idle - pose.landing * 0.025;
      holder.rotation.x = -pose.jumpPose * 0.04 + pose.hit * 0.025;
      holder.rotation.z = pose.celebrating
        ? Math.sin(pose.time * 5.4 + avatar.id) * 0.055
        : pose.procedural.bodyLeanX * -0.08;
    }
    faceKeyLightAtCamera(keyLightRef.current, rootRef.current);
    updateContactRing(ringRef.current, pose.jumping, pose.landing, pose.hit);
  });

  return (
    <group ref={rootRef}>
      <mesh position={[0, 0.004, 0]} ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.23, 32]} />
        <meshBasicMaterial color={accent} depthWrite={false} opacity={0.3} toneMapped={false} transparent />
      </mesh>
      {avatar.isBot ? null : (
        <pointLight color="#f2f8ff" distance={3.8} intensity={8} position={[0, 1.6, 1]} ref={keyLightRef} />
      )}
      <mesh position={[0, 0.76, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.225, 0.014, 8, 28]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.05} />
      </mesh>
      <group ref={poseRef}>
        <group ref={modelRef}>
          <primitive object={model} />
        </group>
      </group>
    </group>
  );
}

function makeInPlaceClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const clip = source.clone();
  clip.tracks = clip.tracks.filter((track) => !/(?:Root|Hips|CharacterArmature)\.position$/u.test(track.name));
  return clip;
}

function setAction(action: THREE.AnimationAction | undefined, weight: number, time: number): void {
  if (!action) return;
  action.enabled = weight > 0.001;
  action.setEffectiveWeight(THREE.MathUtils.clamp(weight, 0, 1));
  const duration = action.getClip().duration;
  action.time = duration > 0 ? THREE.MathUtils.euclideanModulo(time, duration) : 0;
}

function setActionPhase(action: THREE.AnimationAction | undefined, weight: number, phase: number): void {
  if (!action) return;
  const duration = action.getClip().duration;
  setAction(action, weight, duration * THREE.MathUtils.clamp(phase, 0, 0.999));
}

type ModelFit = Readonly<{ scale: number; offset: THREE.Vector3 }>;
const fitCache = new WeakMap<THREE.Object3D, ModelFit>();

function modelFit(scene: THREE.Object3D): ModelFit {
  const cached = fitCache.get(scene);
  if (cached) return cached;
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
  const fit = Object.freeze({
    scale,
    offset: new THREE.Vector3(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale
    )
  });
  fitCache.set(scene, fit);
  return fit;
}
