import { FLOOR_COLS, FLOOR_ROWS, type Frame, type GameSnapshot } from "@motion-levels-games/game-sdk";

import { hexToRgb01, luminance, type Tile } from "./tileMath.ts";

/** A rectangular ready zone, as the SDK's player-ready gate defines them. */
export type ReadyZone = { minX: number; maxX: number; minY: number; maxY: number };

/** Games that expose their zones directly give us an exact answer. */
export type ZoneAwareGame = {
  playerReadyZones?: () => ReadyZone[];
};

const MIN_ZONE_LUMINANCE = 0.05;
/** Max chromaticity distance for a tile to count as "this player's color". */
const COLOR_MATCH_TOLERANCE = 0.3;

/**
 * Where each player must stand for the game to start.
 *
 * Games declare zones privately, and only a few expose an accessor, so when
 * one isn't available we read them off the floor itself: during `waiting`
 * every game paints each zone in that player's own color (pulsing, so we
 * compare chromaticity rather than absolute brightness). Falls back to the
 * lit tiles as a single shared zone.
 */
export function resolveReadyZones(
  game: ZoneAwareGame,
  frame: Frame,
  snapshot: GameSnapshot
): Array<Tile[]> {
  const declared = game.playerReadyZones?.();
  if (declared && declared.length > 0) {
    return declared.map((zone) => zoneTiles(zone));
  }

  const players = snapshot.players ?? [];
  const required = Math.max(1, snapshot.requiredPlayers ?? players.length);
  const litCells = frame.cells.filter((cell) => luminance(cell.color) >= MIN_ZONE_LUMINANCE);

  if (players.length >= required) {
    const byPlayer = players.slice(0, required).map((player) =>
      litCells
        .filter((cell) => chromaDistance(cell.color, player.color) <= COLOR_MATCH_TOLERANCE)
        .map((cell) => ({ x: cell.x, y: cell.y }))
    );
    if (byPlayer.every((tiles) => tiles.length > 0)) {
      return byPlayer;
    }
  }

  const lit = litCells.map((cell) => ({ x: cell.x, y: cell.y }));
  return Array.from({ length: required }, () => lit);
}

export function centroid(tiles: Tile[]): Tile | null {
  if (tiles.length === 0) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (const tile of tiles) {
    sumX += tile.x;
    sumY += tile.y;
  }
  const center = {
    x: Math.round(sumX / tiles.length),
    y: Math.round(sumY / tiles.length)
  };
  // The centroid of an L- or ring-shaped zone can fall outside it; snap to the
  // nearest tile that is actually part of the zone.
  return nearestTile(tiles, center);
}

export function nearestTile(tiles: Tile[], to: Tile): Tile | null {
  let best: Tile | null = null;
  let bestDistance = Infinity;
  for (const tile of tiles) {
    const distance = Math.hypot(tile.x - to.x, tile.y - to.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tile;
    }
  }
  return best;
}

function zoneTiles(zone: ReadyZone): Tile[] {
  const tiles: Tile[] = [];
  const minX = Math.max(0, Math.min(zone.minX, zone.maxX));
  const maxX = Math.min(FLOOR_COLS - 1, Math.max(zone.minX, zone.maxX));
  const minY = Math.max(0, Math.min(zone.minY, zone.maxY));
  const maxY = Math.min(FLOOR_ROWS - 1, Math.max(zone.minY, zone.maxY));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * Distance between two colors ignoring brightness, so a zone dimmed by its
 * idle pulse still matches the player color it was drawn from.
 */
/** True when a tile is drawn in (a dimmed shade of) the given player color. */
export function matchesColor(tileColor: string, playerColor: string): boolean {
  return chromaDistance(tileColor, playerColor) <= COLOR_MATCH_TOLERANCE;
}

function chromaDistance(left: string, right: string): number {
  const a = normalizeChroma(left);
  const b = normalizeChroma(right);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function normalizeChroma(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb01(hex);
  const peak = Math.max(r, g, b);
  if (peak <= 0.001) {
    return { r: 0, g: 0, b: 0 };
  }
  return { r: r / peak, g: g / peak, b: b / peak };
}
