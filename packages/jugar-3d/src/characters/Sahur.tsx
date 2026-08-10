"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { CharacterProps } from "./types.ts";
import { updateContactRing, useCharacterMotion } from "./motion.ts";

export const SAHUR_MODEL_URL = "/models/tung-tung-tung-sahur.glb";

/** Height the model is normalised to, matching the robot's silhouette. */
const TARGET_HEIGHT = 1.55;
/** Playback rate of the walk clip per world unit/second of travel. */
const WALK_RATE_PER_SPEED = 0.42;
const MIN_WALK_RATE = 0.35;

/**
 * Tung Tung Tung Sahur, from a rigged glTF (see ATTRIBUTIONS.md).
 *
 * The model supplies only a walk cycle, so it is combined with the shared
 * procedural driver: that owns position, facing, the jump arc and the victory
 * bounce, while the clip plays the legs. The clip's playback rate follows
 * actual travel speed so the feet do not skate.
 */
export function Sahur({ session, avatar, modelUrl = SAHUR_MODEL_URL }: CharacterProps) {
  const rootRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const keyLightRef = useRef<THREE.PointLight>(null);

  const { scene, animations } = useGLTF(modelUrl);
  const accent = useMemo(() => new THREE.Color(avatar.color), [avatar.color]);

  // Each avatar needs its own skeleton, so a plain clone is not enough.
  const model = useMemo(() => cloneSkinned(scene), [scene]);

  /**
   * Mixamo clips carry hip translation, which would walk the model out of the
   * group the simulation is positioning. Drop those tracks so it walks in
   * place and the rig stays exactly on its tile.
   */
  const inPlaceClips = useMemo(
    () =>
      animations.map((clip: THREE.AnimationClip) => {
        const stationary = clip.clone();
        stationary.tracks = stationary.tracks.filter(
          (track: THREE.KeyframeTrack) => !(track.name.includes("Hips") && track.name.endsWith(".position"))
        );
        return stationary;
      }),
    [animations]
  );

  const { actions } = useAnimations(inPlaceClips, modelRef);
  const walk = actions["Armature|walk"] ?? Object.values(actions)[0] ?? null;
  // The pose callback runs per frame outside render; it reaches the action
  // through a ref so no render-derived value is mutated after render.
  const walkRef = useRef<typeof walk>(null);

  useEffect(() => {
    walkRef.current = walk;
    if (!walk) {
      return;
    }
    walk.reset().play();
    walk.setEffectiveWeight(0);
    return () => {
      walkRef.current = null;
      walk.stop();
    };
  }, [walk]);

  useEffect(() => {
    const ownedMaterials: THREE.Material[] = [];
    // Bots read as background characters: dim them and drop their shadows.
    model.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = !avatar.isBot;
        child.receiveShadow = false;
        const material = child.material;
        if (material instanceof THREE.MeshStandardMaterial && avatar.isBot) {
          const dimmed = material.clone();
          dimmed.color.multiplyScalar(0.68);
          child.material = dimmed;
          ownedMaterials.push(dimmed);
        }
      }
    });
    return () => {
      for (const material of ownedMaterials) material.dispose();
    };
  }, [avatar.isBot, model]);

  // Normalise whatever units the export happens to use: fit to the target
  // height and sit the lowest vertex exactly on the panel.
  useLayoutEffect(() => {
    const holder = modelRef.current;
    if (!holder) {
      return;
    }
    const fit = modelFit(scene);
    holder.scale.setScalar(fit.scale);
    holder.position.copy(fit.offset);
  }, [scene]);

  useCharacterMotion(session, avatar, rootRef, (pose) => {
    const { speed, motion, jumpPose, jumping, celebrating, defeated, time, delta } = pose;

    const walkAction = walkRef.current;
    if (walkAction) {
      walkAction.setEffectiveWeight(motion);
      const playbackRate = jumping
        ? 0.12
        : Math.max(MIN_WALK_RATE, speed * WALK_RATE_PER_SPEED);
      const duration = walkAction.getClip().duration;
      walkAction.time = duration > 0 ? (time * playbackRate) % duration : 0;
      walkAction.paused = true;
    }

    const holder = modelRef.current;
    if (holder) {
      holder.rotation.x = -jumpPose * 0.18 + (defeated ? 0.34 : 0);
      holder.rotation.z = celebrating ? Math.sin(time * 6.5 + avatar.id) * 0.16 : 0;
      // A gentle sway while standing still, so it never looks frozen.
      holder.rotation.y = motion < 0.2 ? Math.sin(time * 1.4 + avatar.id) * 0.09 : 0;
    }

    if (keyLightRef.current && rootRef.current) {
      const yaw = -rootRef.current.rotation.y;
      keyLightRef.current.position.set(Math.sin(yaw) * 1, 1.6, Math.cos(yaw) * 1);
    }
    updateContactRing(ringRef.current, jumping);
    void delta;
  });

  return (
    <group ref={rootRef}>
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

      {avatar.isBot ? null : (
        <pointLight
          color="#ffe9c9"
          distance={3.6}
          intensity={9}
          position={[0, 1.6, 1]}
          ref={keyLightRef}
        />
      )}

      {/* Accent ring at the waist, so a player can still tell which one is
          theirs when everyone is the same wooden log. */}
      <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.016, 8, 24]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} />
      </mesh>

      <group ref={modelRef}>
        <primitive object={model} />
      </group>
    </group>
  );
}

type ModelFit = { scale: number; offset: THREE.Vector3 };

const fitCache = new WeakMap<THREE.Object3D, ModelFit>();

/**
 * How to scale and seat the model so it is TARGET_HEIGHT tall with its soles
 * on y=0.
 *
 * Measured from the **pristine** scene that useGLTF caches, never from the
 * clone we render. The clone is parented into the board (so a world-space
 * measurement would fold in the avatar's position) and its skeleton is driven
 * by the walk clip (so the extents change frame to frame). The source scene is
 * never animated and never moved, so measuring it once gives a stable answer —
 * and this runs once per asset, not once per avatar.
 */
function modelFit(scene: THREE.Object3D): ModelFit {
  const cached = fitCache.get(scene);
  if (cached) {
    return cached;
  }

  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
  const fit: ModelFit = {
    scale,
    offset: new THREE.Vector3(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale
    )
  };

  fitCache.set(scene, fit);
  return fit;
}

// Deliberately no useGLTF.preload(): this module is bundled with the stage, so
// preloading would fetch the model for every player, including the majority
// who never leave the default robot.
