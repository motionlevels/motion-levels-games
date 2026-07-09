import type { FrameCell } from "@motion-levels-games/game-sdk";
import type { RenderableFrame } from "./frameTransforms.ts";
import type { PlaygroundCapture, PlaygroundCaptureSurface } from "./playgroundApi.ts";

export const boardTilePixels = 32;

export function frameToCapture(frame: RenderableFrame, surface: PlaygroundCaptureSurface): PlaygroundCapture {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width * boardTilePixels;
  canvas.height = frame.height * boardTilePixels;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create board capture canvas.");
  }

  drawFrame(context, frame, boardTilePixels);

  return {
    surface,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL("image/png")
  };
}

export async function combinedCapture(
  display: PlaygroundCapture,
  board: PlaygroundCapture
): Promise<PlaygroundCapture> {
  const [displayImage, boardImage] = await Promise.all([
    loadImage(display.dataUrl),
    loadImage(board.dataUrl)
  ]);
  const boardScale = display.height / board.height;
  const boardWidth = Math.round(board.width * boardScale);
  const canvas = document.createElement("canvas");
  canvas.width = display.width + boardWidth;
  canvas.height = display.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create combined capture canvas.");
  }

  context.drawImage(displayImage, 0, 0, display.width, display.height);
  context.drawImage(boardImage, display.width, 0, boardWidth, display.height);

  return {
    surface: "combined",
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL("image/png")
  };
}

function drawFrame(context: CanvasRenderingContext2D, frame: RenderableFrame, tilePixels: number): void {
  context.fillStyle = "#05070a";
  context.fillRect(0, 0, frame.width * tilePixels, frame.height * tilePixels);

  for (const cell of frame.cells) {
    drawCell(context, cell, tilePixels);
  }
}

function drawCell(context: CanvasRenderingContext2D, cell: FrameCell, tilePixels: number): void {
  context.fillStyle = cell.color;
  context.fillRect(cell.x * tilePixels, cell.y * tilePixels, tilePixels, tilePixels);

  context.strokeStyle = "rgba(0, 0, 0, 0.16)";
  context.lineWidth = 1;
  context.strokeRect(cell.x * tilePixels + 0.5, cell.y * tilePixels + 0.5, tilePixels - 1, tilePixels - 1);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load capture image."));
    image.src = dataUrl;
  });
}
