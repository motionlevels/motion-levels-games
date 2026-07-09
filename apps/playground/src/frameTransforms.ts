import type { Frame, FrameCell } from "@motion-levels-games/game-sdk";

export type RenderableFrame = {
  width: number;
  height: number;
  cells: FrameCell[];
};

export function rotateFrameClockwise(frame: RenderableFrame): RenderableFrame {
  return {
    width: frame.height,
    height: frame.width,
    cells: frame.cells.map((cell) => ({
      x: frame.height - 1 - cell.y,
      y: cell.x,
      color: cell.color
    }))
  };
}

export function unrotateFloorPoint(x: number, y: number, originalHeight: number) {
  return {
    x: y,
    y: originalHeight - 1 - x
  };
}

export function asRenderableFrame(frame: Frame): RenderableFrame {
  return frame;
}
