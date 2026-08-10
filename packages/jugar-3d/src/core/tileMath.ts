import { FLOOR_COLS, FLOOR_ROWS, type Frame } from "@motion-levels-games/game-sdk";

export type Tile = { x: number; y: number };

/** World size of one floor tile, in three.js units. */
export const TILE_SIZE = 0.5;
/** Height of the LED panel surface: what characters stand on. */
export const TILE_TOP_Y = 0.04;
export const FLOOR_WORLD_WIDTH = FLOOR_COLS * TILE_SIZE;
export const FLOOR_WORLD_DEPTH = FLOOR_ROWS * TILE_SIZE;

/**
 * Board coordinates: x grows to the right (0..15), y grows toward the player
 * (0..31). Row y=0 sits at the TV end of the floor (negative world z), matching
 * the venue where the player display faces the top of the board.
 */
export function tileToWorld(x: number, y: number): { x: number; z: number } {
  return {
    x: (x - (FLOOR_COLS - 1) / 2) * TILE_SIZE,
    z: (y - (FLOOR_ROWS - 1) / 2) * TILE_SIZE
  };
}

export function worldToTile(worldX: number, worldZ: number): Tile {
  return {
    x: clampInt(Math.round(worldX / TILE_SIZE + (FLOOR_COLS - 1) / 2), 0, FLOOR_COLS - 1),
    y: clampInt(Math.round(worldZ / TILE_SIZE + (FLOOR_ROWS - 1) / 2), 0, FLOOR_ROWS - 1)
  };
}

export function sameTile(a: Tile | null, b: Tile | null): boolean {
  return a !== null && b !== null && a.x === b.x && a.y === b.y;
}

export function clampTile(tile: Tile): Tile {
  return {
    x: clampInt(tile.x, 0, FLOOR_COLS - 1),
    y: clampInt(tile.y, 0, FLOOR_ROWS - 1)
  };
}

/** One greedy 8-directional step from `from` toward `to`. */
export function stepToward(from: Tile, to: Tile): Tile {
  return {
    x: from.x + Math.sign(to.x - from.x),
    y: from.y + Math.sign(to.y - from.y)
  };
}

export function tileDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const hexCache = new Map<string, { r: number; g: number; b: number }>();

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  let cached = hexCache.get(hex);
  if (!cached) {
    const raw = hex.startsWith("#") ? hex.slice(1) : hex;
    const value = Number.parseInt(
      raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw,
      16
    );
    cached = Number.isNaN(value)
      ? { r: 0, g: 0, b: 0 }
      : { r: ((value >> 16) & 0xff) / 255, g: ((value >> 8) & 0xff) / 255, b: (value & 0xff) / 255 };
    hexCache.set(hex, cached);
  }
  return cached;
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb01(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export type LitTile = Tile & { color: string };

/** Tiles in the frame bright enough to read as "lit" for bot navigation. */
export function litTiles(frame: Frame, minLuminance = 0.16): LitTile[] {
  const result: LitTile[] = [];
  for (const cell of frame.cells) {
    if (luminance(cell.color) >= minLuminance) {
      result.push({ x: cell.x, y: cell.y, color: cell.color });
    }
  }
  return result;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
