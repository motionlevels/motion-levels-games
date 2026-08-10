import {
  characterQualityProfiles,
  defaultGridToWorldTransform,
  gridToWorld,
  type CharacterArchetype,
  type CharacterQualityTier,
  type GridToWorldTransform,
  type RenderableAgentSnapshot,
  type SocialGesture
} from "@motion-levels-games/character-runtime";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  FRAME_SIZE,
  type Frame,
  type HexColor
} from "@motion-levels-games/game-sdk";

/**
 * The single authoritative transform used by the floor, characters, and debug
 * overlays. Grid coordinates address tile centres and +grid-y maps to +world-z.
 */
export const RENDERER_GRID_TO_WORLD: Readonly<GridToWorldTransform> = Object.freeze({
  ...defaultGridToWorldTransform
});

export const DEFAULT_FLOOR_COLOR: HexColor = "#101820";
export const DEFAULT_PATH_COLOR: HexColor = "#35d7ff";
export const DEFAULT_RESERVATION_COLOR: HexColor = "#ffe176";
export const DEFAULT_TARGET_COLOR: HexColor = "#ff3bd7";

export type RendererLod = "high" | "medium" | "low" | "hidden";

export type RendererQualitySettings = Readonly<{
  tier: CharacterQualityTier;
  maxCharacters: number;
  dprCap: number;
  antialias: boolean;
  shadowMapEnabled: boolean;
  contactShadows: boolean;
  shadowMapSize: number;
  lodDistances: readonly [number, number];
  hiddenDistance: number;
}>;

export const rendererQualitySettings: Readonly<Record<CharacterQualityTier, RendererQualitySettings>> =
  Object.freeze({
    "venue-high": qualitySettings("venue-high", true, 2_048),
    "desktop-medium": qualitySettings("desktop-medium", true, 1_024),
    "mobile-low": qualitySettings("mobile-low", false, 512),
    capture: qualitySettings("capture", true, 2_048)
  });

export type AgentRenderSnapshot = Readonly<RenderableAgentSnapshot & {
  /** Absolute presentation/simulation timestamp for interpolation. */
  atMillis: number;
  variant?: CharacterArchetype;
  acceleration?: Readonly<{ x: number; y: number }>;
  angularVelocity?: number;
  targetPosition?: Readonly<{ x: number; y: number }>;
  socialGesture?: SocialGesture;
  recentEvent?: "blocked" | "near-miss" | "objective-selected" | "damage" | "success" | "failure";
}>;

export type DebugPath = Readonly<{
  id: string;
  points: readonly Readonly<{ x: number; y: number }>[];
  color?: HexColor;
}>;

export type DebugReservation = Readonly<{
  id: string;
  ownerId?: string;
  points: readonly Readonly<{ x: number; y: number }>[];
  color?: HexColor;
}>;

export type DebugTarget = Readonly<{
  id: string;
  position: Readonly<{ x: number; y: number }>;
  radiusTiles?: number;
  color?: HexColor;
}>;

export type RendererDebugData = Readonly<{
  paths: readonly DebugPath[];
  reservations: readonly DebugReservation[];
  targets: readonly DebugTarget[];
}>;

export type RendererDebugInput = Readonly<{
  paths?: readonly DebugPath[];
  reservations?: readonly DebugReservation[];
  targets?: readonly DebugTarget[];
}>;

export function rendererGridToWorld(point: Readonly<{ x: number; y: number }>): {
  x: number;
  y: number;
  z: number;
} {
  validateGridCoordinate(point, "grid point", false);
  return gridToWorld(point, RENDERER_GRID_TO_WORLD);
}

export function floorCellIndex(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= FLOOR_COLS || y < 0 || y >= FLOOR_ROWS) {
    throw new RangeError(`Floor coordinate (${x}, ${y}) is outside ${FLOOR_COLS}x${FLOOR_ROWS}`);
  }
  return y * FLOOR_COLS + x;
}

/** Returns a complete, immutable 16x32 colour buffer without mutating Frame. */
export function floorColorsFromFrame(
  frame: Frame,
  emptyColor: HexColor = DEFAULT_FLOOR_COLOR
): readonly HexColor[] {
  if (frame.width !== FLOOR_COLS || frame.height !== FLOOR_ROWS) {
    throw new Error(`Expected an authoritative ${FLOOR_COLS}x${FLOOR_ROWS} Frame`);
  }
  assertHexColor(emptyColor, "empty floor colour");
  const colors = Array<HexColor>(FRAME_SIZE).fill(emptyColor);
  for (const cell of frame.cells) {
    assertHexColor(cell.color, `floor cell (${cell.x}, ${cell.y}) colour`);
    colors[floorCellIndex(cell.x, cell.y)] = cell.color;
  }
  return Object.freeze(colors);
}

export function selectRendererLod(
  distance: number,
  settings: RendererQualitySettings
): RendererLod {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new Error("LOD distance must be finite and non-negative");
  }
  if (distance <= settings.lodDistances[0]) return "high";
  if (distance <= settings.lodDistances[1]) return "medium";
  if (distance <= settings.hiddenDistance) return "low";
  return "hidden";
}

/** Deep-clones and freezes caller-owned debug data at the renderer boundary. */
export function snapshotDebugData(input: RendererDebugInput = {}): RendererDebugData {
  const paths = input.paths?.map((path) => {
    validateId(path.id, "debug path");
    assertHexColorIfPresent(path.color, `debug path ${path.id} colour`);
    if (path.points.length < 2) throw new Error(`Debug path ${path.id} requires at least two points`);
    return Object.freeze({
      id: path.id,
      points: freezePoints(path.points, `debug path ${path.id}`),
      ...(path.color === undefined ? {} : { color: path.color })
    });
  }) ?? [];
  const reservations = input.reservations?.map((reservation) => {
    validateId(reservation.id, "debug reservation");
    assertHexColorIfPresent(reservation.color, `debug reservation ${reservation.id} colour`);
    if (reservation.points.length === 0) {
      throw new Error(`Debug reservation ${reservation.id} requires at least one point`);
    }
    return Object.freeze({
      id: reservation.id,
      ...(reservation.ownerId === undefined ? {} : { ownerId: reservation.ownerId }),
      points: freezePoints(reservation.points, `debug reservation ${reservation.id}`),
      ...(reservation.color === undefined ? {} : { color: reservation.color })
    });
  }) ?? [];
  const targets = input.targets?.map((target) => {
    validateId(target.id, "debug target");
    validateGridCoordinate(target.position, `debug target ${target.id}`, true);
    assertHexColorIfPresent(target.color, `debug target ${target.id} colour`);
    const radiusTiles = target.radiusTiles ?? 0.6;
    if (!Number.isFinite(radiusTiles) || radiusTiles <= 0) {
      throw new Error(`Debug target ${target.id} radius must be positive`);
    }
    return Object.freeze({
      id: target.id,
      position: Object.freeze({ ...target.position }),
      radiusTiles,
      ...(target.color === undefined ? {} : { color: target.color })
    });
  }) ?? [];
  return Object.freeze({
    paths: Object.freeze(paths),
    reservations: Object.freeze(reservations),
    targets: Object.freeze(targets)
  });
}

function qualitySettings(
  tier: CharacterQualityTier,
  antialias: boolean,
  shadowMapSize: number
): RendererQualitySettings {
  const profile = characterQualityProfiles[tier];
  const lodDistances = Object.freeze([...profile.lodDistances]) as readonly [number, number];
  return Object.freeze({
    tier,
    maxCharacters: profile.maxCharacters,
    dprCap: profile.dprCap,
    antialias,
    shadowMapEnabled: profile.shadows === "key-character" || profile.shadows === "full",
    contactShadows: profile.shadows === "contact",
    shadowMapSize,
    lodDistances,
    hiddenDistance: lodDistances[1] * 1.75
  });
}

function freezePoints(
  points: readonly Readonly<{ x: number; y: number }>[],
  label: string
): readonly Readonly<{ x: number; y: number }>[] {
  return Object.freeze(points.map((point) => {
    validateGridCoordinate(point, label, true);
    return Object.freeze({ ...point });
  }));
}

function validateGridCoordinate(
  point: Readonly<{ x: number; y: number }>,
  label: string,
  requireTile: boolean
): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} coordinates must be finite`);
  }
  if (requireTile && (
    !Number.isInteger(point.x) || !Number.isInteger(point.y) ||
    point.x < 0 || point.x >= FLOOR_COLS || point.y < 0 || point.y >= FLOOR_ROWS
  )) {
    throw new RangeError(`${label} coordinate (${point.x}, ${point.y}) is outside the floor`);
  }
}

function validateId(id: string, label: string): void {
  if (id.trim().length === 0) throw new Error(`${label} id must not be empty`);
}

function assertHexColorIfPresent(color: HexColor | undefined, label: string): void {
  if (color !== undefined) assertHexColor(color, label);
}

function assertHexColor(color: string, label: string): asserts color is HexColor {
  if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(color)) {
    throw new Error(`${label} must be a three- or six-digit hexadecimal colour`);
  }
}
