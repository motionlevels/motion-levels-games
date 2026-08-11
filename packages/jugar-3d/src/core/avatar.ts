import { FLOOR_COLS, FLOOR_ROWS } from "@motion-levels-games/game-sdk";
import {
  advanceAnimationGraph,
  createAnimationGraphState,
  type AnimationGraphState,
  type AnimationParameters,
  type GameplayAction
} from "@motion-levels-games/character-runtime";

import { TILE_SIZE, sameTile, type Tile } from "./tileMath.ts";

export type PressOp = { kind: "press" | "release"; x: number; y: number };

/** Continuous board position, in tile units. Whole numbers are tile centres. */
export type Point = { x: number; y: number };

export type AvatarUpdateOptions = Readonly<{
  settleAtTarget?: boolean | (() => boolean);
  /** Supplies the next controller waypoint without owning movement or input. */
  nextTarget?(): Readonly<Point> | undefined;
  result?: "success" | "failure";
}>;

export type AvatarFeedback = "damage" | "objective" | "success" | "failure";

export type Avatar = {
  /** Slot in the session. 0 is always the human. */
  id: number;
  /**
   * Which of the game's players this avatar is. Deliberately separate from
   * `id`: the human is handed whichever player's zone sits nearest the camera,
   * so they are not always player 0.
   */
  playerIndex: number;
  isBot: boolean;
  color: string;
  /** Where the character actually is — free to sit anywhere on the board. */
  position: Point;
  /** The tile the feet are over: `position` rounded to the nearest centre. */
  tile: Tile;
  /** Tile currently held down on the floor, null while airborne. */
  pressedTile: Tile | null;
  /** Destination tile centre, null when idle. */
  target: Tile | null;
  /** Travel speed, in tiles per second. */
  speed: number;
  /** Fixed-tick kinematics, in tile units. Rendering never integrates these. */
  velocity: Point;
  acceleration: Point;
  facingRadians: number;
  angularVelocity: number;
  distanceTravelled: number;
  movementStartedAt: number;
  movementEndedAt: number;
  landedAt: number;
  feedback: AvatarFeedback | null;
  feedbackAt: number;
  animationGraph: AnimationGraphState;
  /** Session-clock timestamps for the jump arc; 0 when grounded. */
  jumpStartedAt: number;
  airborneUntil: number;
  /** Bumped every time the character walks onto a new tile. */
  stepCount: number;
  /** Ready zone this bot has claimed while the game waits for players. */
  zoneIndex: number | null;
};

export const JUMP_MILLIS = 520;

/** Close enough to the destination to call it arrived, in tiles. */
const ARRIVE_EPSILON = 0.015;
const ACCELERATION_MULTIPLIER = 9.5;
const BRAKING_MULTIPLIER = 12;
const MAX_TURN_RADIANS_PER_SECOND = 8.5;
const MOTION_EPSILON = 0.025;
/** How firmly an idle character is drawn onto the nearest tile centre. */
const CENTERING_RATE = 7;

export function createAvatar(
  id: number,
  playerIndex: number,
  isBot: boolean,
  color: string,
  spawn: Tile,
  speed: number
): Avatar {
  const tile = clampTile(spawn);
  return {
    id,
    playerIndex,
    isBot,
    color,
    position: { x: tile.x, y: tile.y },
    tile,
    pressedTile: null,
    target: null,
    speed,
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    facingRadians: Math.PI,
    angularVelocity: 0,
    distanceTravelled: 0,
    movementStartedAt: 0,
    movementEndedAt: 0,
    landedAt: 0,
    feedback: null,
    feedbackAt: 0,
    animationGraph: createAnimationGraphState(),
    jumpStartedAt: 0,
    airborneUntil: 0,
    stepCount: 0,
    zoneIndex: null
  };
}

export function isAirborne(avatar: Avatar, clockMillis: number): boolean {
  return avatar.airborneUntil > clockMillis;
}

/** Walk toward a spot. The destination always resolves to a tile centre. */
export function setAvatarTarget(avatar: Avatar, target: Point): void {
  avatar.target = clampTile({ x: Math.round(target.x), y: Math.round(target.y) });
}

export function setAvatarFeedback(
  avatar: Avatar,
  feedback: AvatarFeedback,
  clockMillis: number
): void {
  avatar.feedback = feedback;
  avatar.feedbackAt = clockMillis;
}

export function resetAvatarMotion(avatar: Avatar, spawn: Tile): void {
  const tile = clampTile(spawn);
  avatar.tile = tile;
  avatar.position = { x: tile.x, y: tile.y };
  avatar.pressedTile = null;
  avatar.target = null;
  avatar.velocity = { x: 0, y: 0 };
  avatar.acceleration = { x: 0, y: 0 };
  avatar.facingRadians = Math.PI;
  avatar.angularVelocity = 0;
  avatar.distanceTravelled = 0;
  avatar.movementStartedAt = 0;
  avatar.movementEndedAt = 0;
  avatar.landedAt = 0;
  avatar.feedback = null;
  avatar.feedbackAt = 0;
  avatar.animationGraph = createAnimationGraphState();
  avatar.jumpStartedAt = 0;
  avatar.airborneUntil = 0;
  avatar.stepCount = 0;
  avatar.zoneIndex = null;
}

/**
 * Leave the floor. Jumping does not interrupt travel — the character keeps
 * moving through the arc, so you can jump a gap while crossing it.
 */
export function startAvatarJump(avatar: Avatar, clockMillis: number): PressOp[] {
  if (isAirborne(avatar, clockMillis)) {
    return [];
  }
  avatar.jumpStartedAt = clockMillis;
  avatar.airborneUntil = clockMillis + JUMP_MILLIS;
  if (avatar.pressedTile) {
    const released = avatar.pressedTile;
    avatar.pressedTile = null;
    return [{ kind: "release", x: released.x, y: released.y }];
  }
  return [];
}

/**
 * Advance the character to `clockMillis`, returning the press/release
 * operations the floor should see. Movement is continuous, but the floor only
 * ever sees whole tiles: whichever tile the feet are over is the one held
 * down, which is exactly what the venue's sensors report.
 */
export function updateAvatar(
  avatar: Avatar,
  clockMillis: number,
  deltaMillis: number,
  options: AvatarUpdateOptions = {}
): PressOp[] {
  const ops: PressOp[] = [];
  let remainingSeconds = Math.max(0, deltaMillis) / 1000;
  const previousPosition = { ...avatar.position };
  const previousVelocity = { ...avatar.velocity };
  const wasMoving = vectorLength(previousVelocity) > MOTION_EPSILON;
  const wasAirborne = avatar.airborneUntil > Math.max(0, clockMillis - deltaMillis);

  if (avatar.airborneUntil !== 0 && avatar.airborneUntil <= clockMillis) {
    avatar.airborneUntil = 0;
    avatar.jumpStartedAt = 0;
    if (wasAirborne) avatar.landedAt = clockMillis;
  }
  const airborne = avatar.airborneUntil > clockMillis;

  while (avatar.target && remainingSeconds > 0) {
    const deltaX = avatar.target.x - avatar.position.x;
    const deltaY = avatar.target.y - avatar.position.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance <= ARRIVE_EPSILON) {
      avatar.position.x = avatar.target.x;
      avatar.position.y = avatar.target.y;
      avatar.target = null;
      const next = options.nextTarget?.();
      if (next) {
        setAvatarTarget(avatar, next);
      } else {
        avatar.velocity.x = 0;
        avatar.velocity.y = 0;
      }
    } else {
      const settleAtTarget = typeof options.settleAtTarget === "function"
        ? options.settleAtTarget()
        : options.settleAtTarget ?? true;
      const braking = avatar.speed * BRAKING_MULTIPLIER;
      const targetSpeed = settleAtTarget
        ? Math.min(avatar.speed, Math.sqrt(Math.max(0, 2 * braking * distance)))
        : avatar.speed;
      const desiredVelocity = {
        x: deltaX / distance * targetSpeed,
        y: deltaY / distance * targetSpeed
      };
      const nextVelocity = moveVectorTowards(
        avatar.velocity,
        desiredVelocity,
        avatar.speed * ACCELERATION_MULTIPLIER * remainingSeconds
      );
      const averageVelocity = {
        x: (avatar.velocity.x + nextVelocity.x) / 2,
        y: (avatar.velocity.y + nextVelocity.y) / 2
      };
      const displacement = {
        x: averageVelocity.x * remainingSeconds,
        y: averageVelocity.y * remainingSeconds
      };
      const direction = { x: deltaX / distance, y: deltaY / distance };
      const alongTarget = displacement.x * direction.x + displacement.y * direction.y;
      avatar.velocity = nextVelocity;

      if (alongTarget >= distance) {
        const usedFraction = clamp(distance / Math.max(alongTarget, Number.EPSILON), 0, 1);
        avatar.position.x = avatar.target.x;
        avatar.position.y = avatar.target.y;
        avatar.target = null;
        remainingSeconds *= 1 - usedFraction;
        const next = options.nextTarget?.();
        if (next) {
          setAvatarTarget(avatar, next);
        } else {
          avatar.velocity.x = 0;
          avatar.velocity.y = 0;
        }
      } else {
        avatar.position.x += displacement.x;
        avatar.position.y += displacement.y;
        remainingSeconds = 0;
      }
    }
  }
  if (!avatar.target && !airborne && remainingSeconds > 0 && options.nextTarget === undefined) {
    avatar.velocity = moveVectorTowards(
      avatar.velocity,
      { x: 0, y: 0 },
      avatar.speed * BRAKING_MULTIPLIER * remainingSeconds
    );
    // Subtly grid-align only after the character has shed its travel velocity.
    const damp = 1 - Math.exp(-remainingSeconds * CENTERING_RATE);
    avatar.position.x += (Math.round(avatar.position.x) - avatar.position.x) * damp;
    avatar.position.y += (Math.round(avatar.position.y) - avatar.position.y) * damp;
  }

  avatar.position.x = clamp(avatar.position.x, 0, FLOOR_COLS - 1);
  avatar.position.y = clamp(avatar.position.y, 0, FLOOR_ROWS - 1);
  avatar.distanceTravelled += Math.hypot(
    avatar.position.x - previousPosition.x,
    avatar.position.y - previousPosition.y
  );

  const seconds = Math.max(deltaMillis, 0) / 1_000;
  avatar.acceleration = seconds > 0
    ? {
        x: (avatar.velocity.x - previousVelocity.x) / seconds,
        y: (avatar.velocity.y - previousVelocity.y) / seconds
      }
    : { x: 0, y: 0 };
  updateAvatarFacing(avatar, seconds);

  const moving = vectorLength(avatar.velocity) > MOTION_EPSILON;
  if (!wasMoving && moving) avatar.movementStartedAt = clockMillis;
  if (wasMoving && !moving) avatar.movementEndedAt = clockMillis;
  avatar.animationGraph = advanceAnimationGraph(
    avatar.animationGraph,
    avatarAnimationParameters(avatar, clockMillis, options.result),
    deltaMillis
  );

  const tile = clampTile({
    x: Math.round(avatar.position.x),
    y: Math.round(avatar.position.y)
  });
  const enteredNewTile = !sameTile(tile, avatar.tile);
  avatar.tile = tile;

  if (airborne) {
    if (avatar.pressedTile) {
      ops.push({ kind: "release", x: avatar.pressedTile.x, y: avatar.pressedTile.y });
      avatar.pressedTile = null;
    }
    return ops;
  }

  if (enteredNewTile) {
    avatar.stepCount += 1;
  }
  if (!avatar.pressedTile) {
    avatar.pressedTile = { ...tile };
    ops.push({ kind: "press", x: tile.x, y: tile.y });
  } else if (!sameTile(avatar.pressedTile, tile)) {
    ops.push({ kind: "release", x: avatar.pressedTile.x, y: avatar.pressedTile.y });
    avatar.pressedTile = { ...tile };
    ops.push({ kind: "press", x: tile.x, y: tile.y });
  }

  return ops;
}

export function avatarAnimationParameters(
  avatar: Readonly<Avatar>,
  clockMillis: number,
  result?: "success" | "failure"
): AnimationParameters {
  const feedbackAge = avatar.feedback ? clockMillis - avatar.feedbackAt : Number.POSITIVE_INFINITY;
  const speed = vectorLength(avatar.velocity);
  const desiredAngle = desiredFacing(avatar);
  const relativeTarget = desiredAngle === undefined
    ? 0
    : shortestAngle(avatar.facingRadians, desiredAngle);
  return {
    velocity: { x: avatar.velocity.x * TILE_SIZE, y: avatar.velocity.y * TILE_SIZE },
    acceleration: {
      x: avatar.acceleration.x * TILE_SIZE,
      y: avatar.acceleration.y * TILE_SIZE
    },
    angularVelocity: avatar.angularVelocity,
    grounded: !isAirborne(avatar, clockMillis),
    action: avatarGameplayAction(avatar, clockMillis, result),
    intention: avatar.target ? "move" : "wait",
    targetDirection: { x: Math.sin(relativeTarget), y: Math.cos(relativeTarget) },
    emotion: result === "failure" || avatar.feedback === "failure"
      ? "frustrated"
      : feedbackAge < 600 && avatar.feedback === "damage"
        ? "afraid"
        : result === "success" || avatar.feedback === "success"
          ? "excited"
          : "neutral",
    ...(feedbackAge < 700 ? { recentEvent: recentAnimationEvent(avatar.feedback) } : {}),
    timeSinceMovementBeganMillis: speed > MOTION_EPSILON
      ? Math.max(0, clockMillis - avatar.movementStartedAt)
      : Number.POSITIVE_INFINITY,
    timeSinceMovementEndedMillis: speed <= MOTION_EPSILON
      ? Math.max(0, clockMillis - avatar.movementEndedAt)
      : Number.POSITIVE_INFINITY
  };
}

function avatarGameplayAction(
  avatar: Readonly<Avatar>,
  clockMillis: number,
  result?: "success" | "failure"
): GameplayAction {
  if (result === "failure") return "fall";
  if (result === "success") return "celebrate-team";
  const feedbackAge = avatar.feedback ? clockMillis - avatar.feedbackAt : Number.POSITIVE_INFINITY;
  if (avatar.feedback === "failure" && feedbackAge < 900) return "fall";
  if (avatar.feedback === "success" && feedbackAge < 950) return "celebrate-small";
  if (avatar.feedback === "damage" && feedbackAge < 460) return "hit";
  if (isAirborne(avatar, clockMillis)) {
    return clockMillis - avatar.jumpStartedAt < 140 ? "jump" : "airborne";
  }
  if (avatar.landedAt > 0 && clockMillis - avatar.landedAt < 260) return "land-light";
  return "none";
}

function recentAnimationEvent(
  feedback: AvatarFeedback | null
): AnimationParameters["recentEvent"] | undefined {
  if (feedback === "damage") return "damage";
  if (feedback === "objective") return "objective-selected";
  if (feedback === "success") return "success";
  if (feedback === "failure") return "failure";
  return undefined;
}

function updateAvatarFacing(avatar: Avatar, seconds: number): void {
  const desired = desiredFacing(avatar);
  if (desired === undefined || seconds <= 0) {
    avatar.angularVelocity = 0;
    return;
  }
  const delta = shortestAngle(avatar.facingRadians, desired);
  const applied = clamp(delta, -MAX_TURN_RADIANS_PER_SECOND * seconds, MAX_TURN_RADIANS_PER_SECOND * seconds);
  avatar.facingRadians += applied;
  avatar.angularVelocity = applied / seconds;
}

function desiredFacing(avatar: Readonly<Avatar>): number | undefined {
  if (vectorLength(avatar.velocity) > MOTION_EPSILON) {
    return Math.atan2(avatar.velocity.x, avatar.velocity.y);
  }
  if (!avatar.target) return undefined;
  return Math.atan2(
    avatar.target.x - avatar.position.x,
    avatar.target.y - avatar.position.y
  );
}

function moveVectorTowards(current: Point, target: Point, maxDelta: number): Point {
  const deltaX = target.x - current.x;
  const deltaY = target.y - current.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0 || distance <= maxDelta) return { ...target };
  return {
    x: current.x + deltaX / distance * maxDelta,
    y: current.y + deltaY / distance * maxDelta
  };
}

function vectorLength(point: Readonly<Point>): number {
  return Math.hypot(point.x, point.y);
}

function shortestAngle(from: number, to: number): number {
  const tau = Math.PI * 2;
  let delta = (to - from) % tau;
  if (delta > Math.PI) delta -= tau;
  if (delta < -Math.PI) delta += tau;
  return delta;
}

function clampTile(tile: Tile): Tile {
  return {
    x: clamp(Math.round(tile.x), 0, FLOOR_COLS - 1),
    y: clamp(Math.round(tile.y), 0, FLOOR_ROWS - 1)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
