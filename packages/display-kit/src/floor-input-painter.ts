export type FloorInputTile = {
  x: number;
  y: number;
};

export type FloorInputAction = FloorInputTile & {
  pressed: boolean;
};

export type FloorInputMode = "latched" | "momentary";

type PaintMode = "press" | "release";
type FloorBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;

function tileKey(tile: FloorInputTile): string {
  return `${tile.x}:${tile.y}`;
}

export function floorTileFromClientPoint(
  clientX: number,
  clientY: number,
  bounds: FloorBounds,
  columns: number,
  rows: number
): FloorInputTile | null {
  if (
    columns < 1 ||
    rows < 1 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    clientX < bounds.left ||
    clientY < bounds.top ||
    clientX >= bounds.left + bounds.width ||
    clientY >= bounds.top + bounds.height
  ) {
    return null;
  }

  return {
    x: Math.min(columns - 1, Math.floor(((clientX - bounds.left) / bounds.width) * columns)),
    y: Math.min(rows - 1, Math.floor(((clientY - bounds.top) / bounds.height) * rows))
  };
}

/**
 * Tracks the tiles occupied through an interactive floor gesture.
 *
 * Latched mode paints one consistent state and deliberately keeps crossed
 * tiles occupied after pointer-up so one mouse can represent multiple players.
 * Momentary mode keeps only the tile currently under the pointer occupied.
 */
export class FloorInputPainter {
  private readonly activeTiles = new Map<string, FloorInputTile>();
  private readonly visitedTiles = new Set<string>();
  private lastTile: FloorInputTile | null = null;
  private paintMode: PaintMode | null = null;

  constructor(private readonly inputMode: FloorInputMode = "latched") {}

  begin(tile: FloorInputTile): FloorInputAction[] {
    if (this.inputMode === "momentary") {
      const actions = this.releaseActiveTiles();
      this.paintMode = "press";
      this.lastTile = tile;
      this.activeTiles.set(tileKey(tile), tile);
      actions.push({ ...tile, pressed: true });
      return actions;
    }

    this.visitedTiles.clear();
    this.paintMode = this.activeTiles.has(tileKey(tile)) ? "release" : "press";
    this.lastTile = tile;
    return this.apply(tile);
  }

  move(tile: FloorInputTile | null): FloorInputAction[] {
    if (!this.paintMode) {
      return [];
    }

    if (this.inputMode === "momentary") {
      if (tile && this.lastTile && tileKey(tile) === tileKey(this.lastTile)) {
        return [];
      }

      const actions = this.releaseActiveTiles();
      this.lastTile = tile;
      if (tile) {
        this.activeTiles.set(tileKey(tile), tile);
        actions.push({ ...tile, pressed: true });
      }
      return actions;
    }

    if (!tile) {
      return [];
    }

    const actions = lineTiles(this.lastTile ?? tile, tile).flatMap((crossedTile) => this.apply(crossedTile));
    this.lastTile = tile;
    return actions;
  }

  end(): FloorInputAction[] {
    const actions = this.inputMode === "momentary" ? this.releaseActiveTiles() : [];
    this.lastTile = null;
    this.paintMode = null;
    this.visitedTiles.clear();
    return actions;
  }

  reset(): void {
    this.end();
    this.activeTiles.clear();
  }

  keys(): string[] {
    return [...this.activeTiles.keys()];
  }

  private releaseActiveTiles(): FloorInputAction[] {
    const actions = [...this.activeTiles.values()].map((tile) => ({ ...tile, pressed: false }));
    this.activeTiles.clear();
    return actions;
  }

  private apply(tile: FloorInputTile): FloorInputAction[] {
    const key = tileKey(tile);
    if (!this.paintMode || this.visitedTiles.has(key)) {
      return [];
    }

    this.visitedTiles.add(key);
    const pressed = this.paintMode === "press";
    if (pressed) {
      this.activeTiles.set(key, tile);
    } else {
      this.activeTiles.delete(key);
    }

    return [{ ...tile, pressed }];
  }
}

function lineTiles(start: FloorInputTile, end: FloorInputTile): FloorInputTile[] {
  const tiles: FloorInputTile[] = [];
  let x = start.x;
  let y = start.y;
  const deltaX = Math.abs(end.x - start.x);
  const stepX = start.x < end.x ? 1 : -1;
  const deltaY = -Math.abs(end.y - start.y);
  const stepY = start.y < end.y ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    tiles.push({ x, y });
    if (x === end.x && y === end.y) {
      return tiles;
    }

    const doubledError = error * 2;
    if (doubledError >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubledError <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}
