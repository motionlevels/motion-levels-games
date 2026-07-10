export type FloorInputTile = {
  x: number;
  y: number;
};

export type FloorInputAction = FloorInputTile & {
  pressed: boolean;
};

type PaintMode = "press" | "release";

function tileKey(tile: FloorInputTile): string {
  return `${tile.x}:${tile.y}`;
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
  private paintMode: PaintMode | null = null;

  begin(tile: FloorInputTile): FloorInputAction[] {
    this.visitedTiles.clear();
    this.paintMode = this.activeTiles.has(tileKey(tile)) ? "release" : "press";
    return this.apply(tile);
  }

  move(tile: FloorInputTile): FloorInputAction[] {
    if (!this.paintMode) {
      return [];
    }

    return this.apply(tile);
  }

  end(): void {
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
