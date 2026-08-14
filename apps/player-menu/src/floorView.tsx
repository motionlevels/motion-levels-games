"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, PointerEvent } from "react";

export const DEFAULT_FLOOR_COLS = 16;
export const DEFAULT_FLOOR_ROWS = 32;
export const DEFAULT_FLOOR_EMPTY_COLOR = "#05070a";

export type FloorBoardOrientation = "rotate-0" | "rotate-90" | "rotate-180" | "rotate-270" | "data" | "clockwise" | "transpose";

export type FloorBoardCell = {
  x: number;
  y: number;
  color?: string;
  empty?: boolean;
  pressed?: boolean;
  key?: string | number;
};

type DisplayCells<TCell extends FloorBoardCell> = {
  displayCols: number;
  displayRows: number;
  displayCells: TCell[];
};

type DrawFloorCanvasOptions<TCell extends FloorBoardCell> = DisplayCells<TCell> & {
  canvas: HTMLCanvasElement;
  emptyColor?: string;
  tileSize?: number;
  gapSize?: number;
  symmetricEdgeGaps?: boolean;
  drawCellOverlay?: (
    context: CanvasRenderingContext2D,
    cell: TCell,
    rect: { x: number; y: number; size: number },
  ) => void;
};

type Props<TCell extends FloorBoardCell> = {
  width: number;
  height: number;
  cells: TCell[];
  orientation?: FloorBoardOrientation;
  className?: string;
  tileClassName?: string | ((cell: TCell) => string);
  ariaLabel?: string;
  ariaHidden?: boolean;
  emptyColor?: string;
  interactive?: boolean;
  getTileAriaLabel?: (cell: TCell) => string;
  onTilePointerDown?: (cell: TCell) => void;
  onTilePointerEnter?: (cell: TCell, event: PointerEvent<HTMLButtonElement>) => void;
  onTileFocus?: (cell: TCell) => void;
  onTileClick?: (cell: TCell) => void;
};

type CanvasProps<TCell extends FloorBoardCell> = {
  width: number;
  height: number;
  cells: TCell[];
  orientation?: FloorBoardOrientation;
  className?: string;
  ariaLabel?: string;
  ariaHidden?: boolean;
  emptyColor?: string;
  tileSize?: number;
  gapSize?: number;
  symmetricEdgeGaps?: boolean;
  drawCellOverlay?: DrawFloorCanvasOptions<TCell>["drawCellOverlay"];
};

export function FloorBoard<TCell extends FloorBoardCell>({
  width,
  height,
  cells,
  orientation = "data",
  className = "",
  tileClassName,
  ariaLabel,
  ariaHidden,
  emptyColor = DEFAULT_FLOOR_EMPTY_COLOR,
  interactive = false,
  getTileAriaLabel,
  onTilePointerDown,
  onTilePointerEnter,
  onTileFocus,
  onTileClick,
}: Props<TCell>) {
  const { displayCols, displayRows, displayCells } = useFloorDisplayCells(width, height, cells, orientation, emptyColor);
  const style = floorDisplayStyle(displayCols, displayRows);

  return (
    <div className={`floor-board ${className}`.trim()} style={style} aria-label={ariaLabel} aria-hidden={ariaHidden}>
      {displayCells.map((cell) => {
        const classes = ["floor-board-tile"];
        const extraClass = typeof tileClassName === "function" ? tileClassName(cell) : tileClassName;
        if (extraClass) classes.push(extraClass);
        if (cell.empty) classes.push("empty");
        if (cell.pressed) classes.push("pressed");
        const key = cell.key ?? floorCoordinateKey(cell.x, cell.y);
        const tileStyle = { backgroundColor: cell.color || emptyColor };

        if (interactive) {
          return (
            <button
              key={key}
              type="button"
              className={classes.join(" ")}
              style={tileStyle}
              aria-label={getTileAriaLabel?.(cell)}
              onPointerDown={() => onTilePointerDown?.(cell)}
              onPointerEnter={(event) => onTilePointerEnter?.(cell, event)}
              onFocus={() => onTileFocus?.(cell)}
              onClick={() => onTileClick?.(cell)}
            />
          );
        }

        return <span key={key} className={classes.join(" ")} style={tileStyle} />;
      })}
    </div>
  );
}

export function FloorBoardCanvas<TCell extends FloorBoardCell>({
  width,
  height,
  cells,
  orientation = "data",
  className = "",
  ariaLabel,
  ariaHidden,
  emptyColor = DEFAULT_FLOOR_EMPTY_COLOR,
  tileSize = 1,
  gapSize = 0,
  symmetricEdgeGaps = false,
  drawCellOverlay,
}: CanvasProps<TCell>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { displayCols, displayRows, displayCells } = useFloorDisplayCells(width, height, cells, orientation, emptyColor);
  const style = floorDisplayStyle(displayCols, displayRows);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFloorCanvas({ canvas, displayCols, displayRows, displayCells, emptyColor, tileSize, gapSize, symmetricEdgeGaps, drawCellOverlay });
  }, [displayCells, displayCols, displayRows, drawCellOverlay, emptyColor, gapSize, symmetricEdgeGaps, tileSize]);

  return (
    <canvas
      ref={canvasRef}
      className={`floor-board-canvas ${className}`.trim()}
      style={style}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
    />
  );
}

export function useFloorDisplayCells<TCell extends FloorBoardCell>(
  width: number,
  height: number,
  cells: TCell[],
  orientation: FloorBoardOrientation = "data",
  emptyColor = DEFAULT_FLOOR_EMPTY_COLOR,
): DisplayCells<TCell> {
  return useMemo(() => floorDisplayCells(width, height, cells, orientation, emptyColor), [cells, emptyColor, height, orientation, width]);
}

export function floorDisplayCells<TCell extends FloorBoardCell>(
  width: number,
  height: number,
  cells: TCell[],
  orientation: FloorBoardOrientation = "data",
  emptyColor = DEFAULT_FLOOR_EMPTY_COLOR,
): DisplayCells<TCell> {
  const normalizedOrientation = normalizeFloorBoardOrientation(orientation);
  const rotatedSideways = normalizedOrientation === "rotate-90" || normalizedOrientation === "rotate-270";
  const displayCols = rotatedSideways ? height : width;
  const displayRows = rotatedSideways ? width : height;
  const cellsByCoordinate = new Map(cells.map((cell) => [floorCoordinateKey(cell.x, cell.y), cell]));
  const displayCells = Array.from({ length: displayCols * displayRows }, (_, index) => {
    const displayX = index % displayCols;
    const displayY = Math.floor(index / displayCols);
    const { x, y } = displayToFloorCoordinate(displayX, displayY, width, height, normalizedOrientation);
    return cellsByCoordinate.get(floorCoordinateKey(x, y)) ?? ({ x, y, color: emptyColor, empty: true } as TCell);
  });
  return { displayCols, displayRows, displayCells };
}

export function drawFloorCanvas<TCell extends FloorBoardCell>({
  canvas,
  displayCols,
  displayRows,
  displayCells,
  emptyColor = DEFAULT_FLOOR_EMPTY_COLOR,
  tileSize = 1,
  gapSize = 0,
  symmetricEdgeGaps = false,
  drawCellOverlay,
}: DrawFloorCanvasOptions<TCell>) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const pitch = tileSize + gapSize;
  const edgeGap = symmetricEdgeGaps ? gapSize / 2 : gapSize;
  const trailingGap = symmetricEdgeGaps ? 0 : gapSize;
  const width = displayCols * pitch + trailingGap;
  const height = displayRows * pitch + trailingGap;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.imageSmoothingEnabled = false;
  context.fillStyle = emptyColor;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < displayCells.length; index++) {
    const cell = displayCells[index];
    const x = edgeGap + (index % displayCols) * pitch;
    const y = edgeGap + Math.floor(index / displayCols) * pitch;
    context.fillStyle = cell.color || emptyColor;
    context.fillRect(x, y, tileSize, tileSize);
    drawCellOverlay?.(context, cell, { x, y, size: tileSize });
  }
}

export function floorDisplayStyle(displayCols: number, displayRows: number): CSSProperties {
  return {
    "--floor-cols": displayCols,
    "--floor-rows": displayRows,
    "--floor-aspect": displayCols / displayRows,
    "--board-cols": displayCols,
    "--board-rows": displayRows,
    "--board-aspect": displayCols / displayRows,
  } as CSSProperties;
}

export function floorCoordinateKey(x: number, y: number) {
  return `${x},${y}`;
}

function normalizeFloorBoardOrientation(orientation: FloorBoardOrientation): Exclude<FloorBoardOrientation, "data" | "clockwise" | "transpose"> {
  if (orientation === "clockwise") return "rotate-90";
  if (orientation === "transpose") return "rotate-270";
  if (orientation === "rotate-90" || orientation === "rotate-180" || orientation === "rotate-270") return orientation;
  return "rotate-0";
}

function displayToFloorCoordinate(displayX: number, displayY: number, width: number, height: number, orientation: ReturnType<typeof normalizeFloorBoardOrientation>) {
  if (orientation === "rotate-90") {
    return { x: displayY, y: height - 1 - displayX };
  }
  if (orientation === "rotate-180") {
    return { x: width - 1 - displayX, y: height - 1 - displayY };
  }
  if (orientation === "rotate-270") {
    return { x: width - 1 - displayY, y: displayX };
  }
  return { x: displayX, y: displayY };
}
