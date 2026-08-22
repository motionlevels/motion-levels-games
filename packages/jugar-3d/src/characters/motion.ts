"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, type RefObject } from "react";
import * as THREE from "three";
import {
  animationBlendWeights,
  proceduralPose,
  type AnimationChannelState,
  type AnimationGraphState,
  type AnimationClipName,
  type ProceduralPose
} from "@motion-levels-games/character-runtime";

import { JUMP_MILLIS, avatarAnimationParameters, type Avatar } from "../core/avatar.ts";
import type { JugarPresentationSession } from "../core/session.ts";
import { TILE_SIZE, TILE_TOP_Y, tileToWorld } from "../core/tileMath.ts";

/**
 * Shared skeleton metrics. Every character is built around these so its soles
 * land exactly on y=0 in its own space, and therefore exactly on the LED panel:
 *
 *   HIP_Y + LEG_GROUP_Y + FOOT_Y - FOOT_HEIGHT / 2 === 0
 *
 * A character that needs different proportions must still satisfy that, or it
 * will float above the tile the game believes is pressed.
 */
export const HIP_Y = 0.62;
export const LEG_GROUP_Y = -0.32;
export const FOOT_Y = -0.27;
export const FOOT_HEIGHT = 0.06;

/** Per-frame animation state handed to a character so it can pose its limbs. */
export type CharacterPose = {
  /** Seconds since the scene started. */
  time: number;
  /** Seconds since the previous frame. */
  delta: number;
  /** True while the character is travelling. */
  moving: boolean;
  /** Travel speed in world units per second. */
  speed: number;
  /** Walk cycle, -1..1. Legs and arms swing on this. */
  stride: number;
  /** Quarter-phase-shifted walk cycle, for bounce and counter-rotation. */
  counterStride: number;
  /** 0..1 blend into the walk cycle, so starts and stops are not abrupt. */
  motion: number;
  /** 0 on the ground, rising to 1 at the top of the jump arc. */
  jumpPose: number;
  /** 0..1 progress through the complete jump, without reversing after the apex. */
  jumpProgress: number;
  jumping: boolean;
  landing: number;
  hit: number;
  celebrating: boolean;
  defeated: boolean;
  animationGraph: AnimationGraphState;
  procedural: ProceduralPose;
};

export type DeterministicLocomotionPose = Readonly<{
  time: number;
  moving: boolean;
  speed: number;
  motion: number;
  stride: number;
  counterStride: number;
}>;

/**
 * Samples locomotion from retained authority alone. It intentionally owns no
 * render-history accumulator, so replaying or repeatedly seeking one recorded
 * tick produces the same body pose regardless of the surrounding rAF frames.
 */
export function deterministicLocomotionPose(
  avatar: Readonly<Avatar>,
  presentationMillis: number
): DeterministicLocomotionPose {
  const time = Math.max(0, presentationMillis) / 1_000;
  const speed = Math.hypot(avatar.velocity.x, avatar.velocity.y) * TILE_SIZE;
  const locomotionWeights = animationBlendWeights(avatar.animationGraph.locomotion);
  const motion = THREE.MathUtils.clamp(
    MOVING_CLIPS.reduce((sum, clip) => sum + (locomotionWeights[clip] ?? 0), 0),
    0,
    1
  );
  const moving = speed > 0.02 || motion > 0.02;
  // Phase follows actual ground covered, so retargeting and frame partitioning
  // cannot make the feet pedal or skate while the authority is slowing down.
  const phase = avatar.id * 1.7 + avatar.distanceTravelled * 5.6;
  const stride = motion === 0 ? 0 : Math.sin(phase) * motion;
  const counterStride = motion === 0 ? 0 : Math.cos(phase) * motion;
  return {
    time,
    moving,
    speed,
    motion,
    stride,
    counterStride
  };
}

/**
 * Drives one character: places the root on the board, faces it along its
 * travel, runs the jump arc and walk cycle, then hands the resulting pose to
 * the character so it can animate its own limbs.
 *
 * The root tracks `avatar.position` exactly — what you see is the tile the
 * game is being told about — and only ever lifts off the panel, never sinks.
 */
export function useCharacterMotion(
  session: JugarPresentationSession,
  avatar: Avatar,
  rootRef: RefObject<THREE.Group | null>,
  applyPose: (pose: CharacterPose) => void
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const world = tileToWorld(avatar.position.x, avatar.position.y);
    root.position.set(world.x, TILE_TOP_Y, world.z);
    root.rotation.y = Math.PI; // face the TV
  }, [avatar, rootRef]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const locomotion = deterministicLocomotionPose(avatar, session.presentationMillis);
    const { time, moving, speed, motion, stride, counterStride } = locomotion;
    const snapshot = session.state.snapshot;
    const finished = String(snapshot.phase) === "finished";
    const celebrating = finished && snapshot.success;
    const defeated = finished && !snapshot.success;

    const world = tileToWorld(avatar.position.x, avatar.position.y);
    root.position.x = world.x;
    root.position.z = world.z;
    root.rotation.y = avatar.facingRadians;

    // Jump arc from the session clock, matching the press/release the game saw.
    const jumping = avatar.airborneUntil > session.presentationMillis;
    const jumpDuration = Math.max(JUMP_MILLIS, avatar.airborneUntil - avatar.jumpStartedAt);
    const jumpProgress = jumping
      ? THREE.MathUtils.clamp((session.presentationMillis - avatar.jumpStartedAt) / jumpDuration, 0, 1)
      : 0;
    const jumpPose = jumping ? Math.sin(jumpProgress * Math.PI) : 0;
    const landing = animationClipWeight(avatar.animationGraph.fullBody, "land-light");
    const hit = animationClipWeight(avatar.animationGraph.fullBody, "hit");
    const result = finished ? (snapshot.success ? "success" : "failure") : undefined;
    const parameters = avatarAnimationParameters(avatar, session.presentationMillis, result);
    const procedural = proceduralPose(
      parameters,
      Math.round(session.presentationMillis / session.frameMillis),
      session.seed + avatar.id * 101
    );

    const victory = celebrating ? Math.abs(Math.sin(time * 4.6 + avatar.id)) * 0.4 : 0;
    const bounce = Math.abs(counterStride) * 0.05;

    root.position.y = TILE_TOP_Y + bounce + jumpPose * 0.72 + victory;
    root.scale.set(
      1 - jumpPose * 0.06 + landing * 0.035,
      1 + jumpPose * 0.1 - landing * 0.055,
      1 - jumpPose * 0.06 + landing * 0.035
    );

    applyPose({
      time,
      delta,
      moving,
      speed,
      stride,
      counterStride,
      motion,
      jumpPose,
      jumpProgress,
      jumping,
      landing,
      hit,
      celebrating,
      defeated,
      animationGraph: avatar.animationGraph,
      procedural
    });
  });
}

const MOVING_CLIPS: readonly AnimationClipName[] = [
  "walk",
  "run",
  "strafe-left",
  "strafe-right",
  "turn-left",
  "turn-right",
  "pivot",
  "stop-recover"
];

export function animationClipWeight(
  channel: AnimationChannelState | undefined,
  clip: AnimationClipName
): number {
  if (!channel) return 0;
  let weight = channel.clip === clip ? channel.currentWeight : 0;
  if (channel.previousClip === clip) weight += channel.previousWeight;
  return THREE.MathUtils.clamp(weight, 0, 1);
}

/**
 * Keeps a character's key light on the camera side whatever way it is facing,
 * by undoing the root's yaw. Call from inside `applyPose`.
 */
export function faceKeyLightAtCamera(
  light: THREE.PointLight | null,
  root: THREE.Group | null,
  height = 1.6,
  distance = 1
): void {
  if (!light || !root) {
    return;
  }
  const yaw = -root.rotation.y;
  light.position.set(Math.sin(yaw) * distance, height, Math.cos(yaw) * distance);
}

/** Contact ring fades and widens as the character leaves the ground. */
export function updateContactRing(
  ring: THREE.Mesh | null,
  jumping: boolean,
  landing = 0,
  hit = 0
): void {
  if (!ring) {
    return;
  }
  (ring.material as THREE.MeshBasicMaterial).opacity = jumping ? 0.04 : 0.3 + landing * 0.16;
  ring.scale.setScalar(jumping ? 1.4 : 1 + landing * 0.22 + hit * 0.05);
}
