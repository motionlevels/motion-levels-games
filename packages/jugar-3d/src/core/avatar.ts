import { FLOOR_COLS, FLOOR_ROWS } from "@motion-levels-games/game-sdk";

import { sameTile, type Tile } from "./tileMath.ts";

export type PressOp = { kind: "press" | "release"; x: number; y: number };

/** Continuous board position, in tile units. Whole numbers are tile centres. */
export type Point = { x: number; y: number };

export type AvatarUpdateOptions = Readonly<{
  settleAtTarget?: boolean | (() => boolean);
  /** Supplies the next controller waypoint without owning movement or input. */
  nextTarget?(): Readonly<Point> | undefined;
}>;

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
/**
 * Distance over which the character eases down to its arrival speed, so it
 * settles onto a tile centre instead of stopping dead on it.
 */
const SETTLE_DISTANCE = 0.8;
const MIN_SPEED_FRACTION = 0.28;
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

  if (avatar.airborneUntil !== 0 && avatar.airborneUntil <= clockMillis) {
    avatar.airborneUntil = 0;
    avatar.jumpStartedAt = 0;
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
      if (next) setAvatarTarget(avatar, next);
    } else {
      const settleAtTarget = typeof options.settleAtTarget === "function"
        ? options.settleAtTarget()
        : options.settleAtTarget ?? true;
      const easing = settleAtTarget
        ? clamp(distance / SETTLE_DISTANCE, MIN_SPEED_FRACTION, 1)
        : 1;
      const travelPerSecond = avatar.speed * easing;
      const step = Math.min(distance, travelPerSecond * remainingSeconds);
      avatar.position.x += (deltaX / distance) * step;
      avatar.position.y += (deltaY / distance) * step;
      remainingSeconds -= step / travelPerSecond;
      if (step >= distance) {
        avatar.position.x = avatar.target.x;
        avatar.position.y = avatar.target.y;
        avatar.target = null;
        const next = options.nextTarget?.();
        if (next) setAvatarTarget(avatar, next);
      }
    }
  }
  if (!avatar.target && !airborne && remainingSeconds > 0 && options.nextTarget === undefined) {
    // Free movement, but subtly grid-aligned: an idle character drifts onto
    // the centre of whichever tile it is standing on.
    const damp = 1 - Math.exp(-remainingSeconds * CENTERING_RATE);
    avatar.position.x += (Math.round(avatar.position.x) - avatar.position.x) * damp;
    avatar.position.y += (Math.round(avatar.position.y) - avatar.position.y) * damp;
  }

  avatar.position.x = clamp(avatar.position.x, 0, FLOOR_COLS - 1);
  avatar.position.y = clamp(avatar.position.y, 0, FLOOR_ROWS - 1);

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

function clampTile(tile: Tile): Tile {
  return {
    x: clamp(Math.round(tile.x), 0, FLOOR_COLS - 1),
    y: clamp(Math.round(tile.y), 0, FLOOR_ROWS - 1)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
