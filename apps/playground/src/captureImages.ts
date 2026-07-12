import { toPng } from "html-to-image";
import { nativeDisplayHeight, nativeDisplayWidth } from "./displayConstants.ts";
import { combinedCapture, frameToCapture } from "./boardCapture.ts";
import type { RenderableFrame } from "./frameTransforms.ts";
import { loadDataUrlImage } from "./imageLoading.ts";
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
    // State changes can be synchronous while React commits the matching display
    // on the next paint. Capture only after that commit is visible so automated
    // playtests and the copy actions never serialize a half-transitioned frame.
    await waitForPaint();
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

  const previousCaptureState = displayElement.getAttribute("data-native-capture");
  displayElement.setAttribute("data-native-capture", "true");
  await waitForPaint();

  const captureOptions = {
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
  } as const;

  let dataUrl: string;
  try {
    // Chromium occasionally omits newly composited grid children from the
    // first foreign-object raster after a display state change. Prime that
    // raster once, then serialize the complete native frame. This also keeps
    // generated player-display animations free from intermittent blank cards.
    await toPng(displayElement, captureOptions);
    dataUrl = await toPng(displayElement, captureOptions);
  } finally {
    if (previousCaptureState === null) {
      displayElement.removeAttribute("data-native-capture");
    } else {
      displayElement.setAttribute("data-native-capture", previousCaptureState);
    }
  }

  return {
    surface: "display",
    width: nativeDisplayWidth,
    height: nativeDisplayHeight,
    dataUrl
  };
}

export async function downscaleCaptureToWebp(
  dataUrl: string,
  width: number,
  height: number,
  quality: number
): Promise<string> {
  return downscaleCapture(dataUrl, width, height, "image/webp", quality);
}

export async function downscaleCaptureToPng(
  dataUrl: string,
  width: number,
  height: number
): Promise<string> {
  return downscaleCapture(dataUrl, width, height, "image/png");
}

async function downscaleCapture(
  dataUrl: string,
  width: number,
  height: number,
  mimeType: "image/png" | "image/webp",
  quality?: number
): Promise<string> {
  const image = await loadDataUrlImage(dataUrl, "Could not load player display capture.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create player display media canvas.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function captureDisplay(displayElement: HTMLElement | null): Promise<PlaygroundCapture> {
  return captureDisplayElement(displayElement);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
