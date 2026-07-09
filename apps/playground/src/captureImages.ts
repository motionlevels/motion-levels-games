import { toPng } from "html-to-image";
import { nativeDisplayHeight, nativeDisplayWidth } from "./displayConstants.ts";
import { combinedCapture, frameToCapture } from "./boardCapture.ts";
import type { RenderableFrame } from "./frameTransforms.ts";
import type { PlaygroundCapture, PlaygroundCaptureSurface } from "./playgroundApi.ts";

export const defaultCaptureSurfaces: PlaygroundCaptureSurface[] = [
  "display",
  "boardPreview",
  "boardPhysical",
  "combined"
];

export type CaptureInput = {
  displayElement: HTMLElement | null;
  frame: RenderableFrame;
  previewFrame: RenderableFrame;
  surfaces?: PlaygroundCaptureSurface[];
};

export async function capturePlaygroundSurfaces({
  displayElement,
  frame,
  previewFrame,
  surfaces = defaultCaptureSurfaces
}: CaptureInput): Promise<Record<PlaygroundCaptureSurface, PlaygroundCapture>> {
  const requested = new Set(surfaces);
  const captures: Partial<Record<PlaygroundCaptureSurface, PlaygroundCapture>> = {};

  if (requested.has("display") || requested.has("combined")) {
    captures.display = await captureDisplay(displayElement);
  }
  if (requested.has("boardPreview") || requested.has("combined")) {
    captures.boardPreview = frameToCapture(previewFrame, "boardPreview");
  }
  if (requested.has("boardPhysical")) {
    captures.boardPhysical = frameToCapture(frame, "boardPhysical");
  }
  if (requested.has("combined")) {
    const display = captures.display ?? await captureDisplay(displayElement);
    const board = captures.boardPreview ?? frameToCapture(previewFrame, "boardPreview");
    captures.combined = await combinedCapture(display, board);
  }

  return captures as Record<PlaygroundCaptureSurface, PlaygroundCapture>;
}

export async function copyCaptureToClipboard(capture: PlaygroundCapture): Promise<boolean> {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function" || typeof ClipboardItem === "undefined") {
    return false;
  }

  const blob = await dataUrlToBlob(capture.dataUrl);
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob
    })
  ]);
  return true;
}

export async function captureDisplayElement(displayElement: HTMLElement | null): Promise<PlaygroundCapture> {
  if (!displayElement) {
    throw new Error("Player display is not mounted.");
  }

  const dataUrl = await toPng(displayElement, {
    cacheBust: true,
    height: nativeDisplayHeight,
    pixelRatio: 1,
    style: {
      height: `${nativeDisplayHeight}px`,
      position: "relative",
      transform: "none",
      width: `${nativeDisplayWidth}px`
    },
    width: nativeDisplayWidth
  });

  return {
    surface: "display",
    width: nativeDisplayWidth,
    height: nativeDisplayHeight,
    dataUrl
  };
}

async function captureDisplay(displayElement: HTMLElement | null): Promise<PlaygroundCapture> {
  return captureDisplayElement(displayElement);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
