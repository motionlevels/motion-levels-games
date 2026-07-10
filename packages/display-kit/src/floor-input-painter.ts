export type FloorInputTile = {
  x: number;
  y: number;
};

export type FloorInputAction = FloorInputTile & {
  pressed: boolean;
};

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
 * A gesture paints one consistent state: starting on an empty tile presses
 * every crossed tile, while starting on an occupied tile releases them. The
 * occupied tiles deliberately remain active after pointer-up so a mouse can
 * represent multiple players standing on different parts of the floor.
 */
export class FloorInputPainter {
  private readonly activeTiles = new Map<string, FloorInputTile>();
  private readonly visitedTiles = new Set<string>();
  private lastTile: FloorInputTile | null = null;
  private paintMode: PaintMode | null = null;

  begin(tile: FloorInputTile): FloorInputAction[] {
    this.visitedTiles.clear();
    this.paintMode = this.activeTiles.has(tileKey(tile)) ? "release" : "press";
    this.lastTile = tile;
    return this.apply(tile);
  }

  move(tile: FloorInputTile): FloorInputAction[] {
    if (!this.paintMode) {
      return [];
    }

    const actions = lineTiles(this.lastTile ?? tile, tile).flatMap((crossedTile) => this.apply(crossedTile));
    this.lastTile = tile;
    return actions;
  }

  end(): void {
    this.lastTile = null;
    this.paintMode = null;
    this.visitedTiles.clear();
  }

  reset(): void {
    this.end();
    this.activeTiles.clear();
  }

  keys(): string[] {
    return [...this.activeTiles.keys()];
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
