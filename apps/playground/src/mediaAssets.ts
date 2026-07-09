import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
  DEFAULT_ENGINE_FPS,
  DEFAULT_ENGINE_FRAME_MILLIS,
  createGameEngine,
  type Frame,
  type GameConfig,
  type GameConfigOptions,
  type GameEngine,
  type GameEngineState,
  type GameDifficulty
} from "@motion-levels-games/game-sdk";
import type { PlaygroundGame } from "./gameRegistry.ts";
import { rotateFrameClockwise, type RenderableFrame } from "./frameTransforms.ts";

export type PlaygroundMediaAssetKind = "thumbnailSmall" | "thumbnail" | "animation" | "playerDisplay";

export type PlaygroundMediaAsset = {
  kind: PlaygroundMediaAssetKind;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  dataUrl: string;
};

export type PlaygroundMediaBundle = {
  gameId: string;
  label: string;
  difficulty: GameDifficulty;
  options: GameConfigOptions;
  seed: number;
  playerCount: number;
  generatedAt: string;
  assets: Record<PlaygroundMediaAssetKind, PlaygroundMediaAsset>;
};

export type PlaygroundMediaOptions = {
  difficulty?: GameDifficulty;
  options?: GameConfigOptions;
  seed?: number;
  playerCount?: number;
};

export type PlayerDisplayAssetRenderer = (input: {
  fileName: string;
  frame: Frame;
  game: PlaygroundGame;
  snapshot: GameEngineState["snapshot"];
}) => Promise<PlaygroundMediaAsset>;

type PreviewFrame = {
  frame: RenderableFrame;
  delayMs: number;
};

type WebPEncoderModule = {
  HEAP8: Int8Array;
  calledRun?: boolean;
  cwrap: (name: string, returnType: string, argTypes: string[]) => (...args: number[]) => number;
};

let webpEncoderModulePromise: Promise<WebPEncoderModule> | null = null;

const thumbnailSmallTilePixels = 8;
const thumbnailTilePixels = 32;
const animationTilePixels = 16;
const animationFrameCount = 18;
const animationFrameDelayMs = 120;

export async function generateGameMediaBundle(
  game: PlaygroundGame,
  renderPlayerDisplay: PlayerDisplayAssetRenderer,
  options: PlaygroundMediaOptions = {}
): Promise<PlaygroundMediaBundle> {
  const seed = normalizeSeed(options.seed, game.manifest.defaultSeed);
  const playerCount = normalizePlayerCount(options.playerCount, game.manifest.players.min, game.manifest.players.max);
  const difficulty = options.difficulty ?? game.manifest.config?.difficulty?.default ?? "medium";
  const configOptions = options.options ?? {};
  const engine = createPreviewEngine(game, { difficulty, options: configOptions, playerCount, seed });
  const frames = collectPreviewFrames(engine);
  const stillFrame = frames[Math.min(4, frames.length - 1)]?.frame ?? rotateFrameClockwise(engine.state.frame);
  const baseName = game.manifest.id;
  const playerDisplay = await renderPlayerDisplay({
    fileName: `${baseName}-player-display.webp`,
    frame: engine.state.frame,
    game,
    snapshot: engine.state.snapshot
  });

  return {
    gameId: game.manifest.id,
    label: game.manifest.label,
    difficulty,
    options: configOptions,
    seed,
    playerCount,
    generatedAt: new Date().toISOString(),
    assets: {
      thumbnailSmall: frameToImageAsset(stillFrame, {
        fileName: `${baseName}-thumbnail-small.webp`,
        kind: "thumbnailSmall",
        mimeType: "image/webp",
        quality: 0.45,
        tilePixels: thumbnailSmallTilePixels
      }),
      thumbnail: frameToImageAsset(stillFrame, {
        fileName: `${baseName}-thumbnail.webp`,
        kind: "thumbnail",
        mimeType: "image/webp",
        quality: 0.92,
        tilePixels: thumbnailTilePixels
      }),
      animation: await framesToAnimatedWebpAsset(frames, `${baseName}-preview.webp`),
      playerDisplay
    }
  };
}

function createPreviewEngine(
  game: PlaygroundGame,
  config: Pick<GameConfig, "difficulty" | "options" | "playerCount" | "seed">
): GameEngine {
  const instance = game.createGame({
    seed: config.seed,
    playerCount: config.playerCount,
    durationMillis: game.manifest.defaultDurationMillis,
    difficulty: config.difficulty,
    options: config.options,
    nowMillis: 0
  });
  const events = instance.init(0);
  return createGameEngine(instance, {
    fps: DEFAULT_ENGINE_FPS,
    initialEvents: events
  });
}

function collectPreviewFrames(engine: GameEngine): PreviewFrame[] {
  const frames: PreviewFrame[] = [];

  primePreviewInputs(engine);
  for (let index = 0; index < animationFrameCount; index += 1) {
    if (index > 0 && index % 5 === 0) {
      tapPreviewPoint(engine, index);
    }

    const state = engine.step(animationFrameDelayMs);
    frames.push({
      frame: rotateFrameClockwise(state.frame),
      delayMs: animationFrameDelayMs
    });
  }

  return frames;
}

function primePreviewInputs(engine: GameEngine): void {
  engine.press(4, 4);
  engine.press(11, 27);
  engine.step(DEFAULT_ENGINE_FRAME_MILLIS);
}

function tapPreviewPoint(engine: GameEngine, index: number): void {
  const points = [
    { x: 3, y: 5 },
    { x: 12, y: 8 },
    { x: 5, y: 17 },
    { x: 10, y: 25 },
    { x: 8, y: 16 }
  ];
  const point = points[index % points.length] ?? points[0];
  engine.press(point.x, point.y);
  engine.release(point.x, point.y);
}

function frameToImageAsset(
  frame: RenderableFrame,
  options: {
    fileName: string;
    kind: PlaygroundMediaAssetKind;
    mimeType: "image/png" | "image/webp";
    quality?: number;
    tilePixels: number;
  }
): PlaygroundMediaAsset {
  const canvas = frameToCanvas(frame, options.tilePixels);
  const dataUrl = canvas.toDataURL(options.mimeType, options.quality);
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(";"));

  return {
    kind: options.kind,
    width: canvas.width,
    height: canvas.height,
    mimeType,
    fileName: options.fileName,
    dataUrl
  };
}

async function framesToAnimatedWebpAsset(frames: PreviewFrame[], fileName: string): Promise<PlaygroundMediaAsset> {
  const first = frames[0]?.frame;
  if (!first) {
    throw new Error("Cannot render an animation without frames.");
  }

  const width = first.width * animationTilePixels;
  const height = first.height * animationTilePixels;
  const encoder = GIFEncoder();

  for (const frame of frames) {
    const canvas = frameToCanvas(frame.frame, animationTilePixels);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not render animation frame.");
    }

    const rgba = context.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, width, height, {
      delay: frame.delayMs,
      palette
    });
  }

  encoder.finish();
  const gifBytes = encoder.bytesView();
  const webpBytes = await encodeGifBytesToWebp(gifBytes);

  return {
    kind: "animation",
    width,
    height,
    mimeType: "image/webp",
    fileName,
    dataUrl: bytesToDataUrl(webpBytes, "image/webp")
  };
}

async function encodeGifBytesToWebp(gifBytes: Uint8Array): Promise<Uint8Array> {
  const encoder = await loadWebPEncoderModule();

  return withSuppressedWebPEncoderLogs(() => {
    const allocateMemory = encoder.cwrap("allocate_memory", "number", ["number"]);
    const deallocateMemory = encoder.cwrap("deallocate_memory", "", ["number"]);
    const encodeGif = encoder.cwrap("encode_gif", "", ["number", "number", "number"]);
    const getResultMemoryPointer = encoder.cwrap("get_output_pointer", "number", []);
    const getResultMemorySize = encoder.cwrap("get_output_size", "number", []);
    const freeMemory = encoder.cwrap("free_result", "", ["number"]);
    const sourcePointer = allocateMemory(gifBytes.length);

    encoder.HEAP8.set(gifBytes, sourcePointer);
    encodeGif(sourcePointer, gifBytes.length, 0);
    deallocateMemory(sourcePointer);

    const outputPointer = getResultMemoryPointer();
    const outputSize = getResultMemorySize();
    const outputBuffer = new Uint8Array(encoder.HEAP8.buffer, outputPointer, outputSize);
    const result = new Uint8Array(outputBuffer);
    freeMemory(outputPointer);

    if (result.length === 0) {
      throw new Error("WebP animation encoder returned an empty image.");
    }

    return result;
  });
}

async function loadWebPEncoderModule(): Promise<WebPEncoderModule> {
  webpEncoderModulePromise ??= withSuppressedWebPEncoderLogsAsync(async () => {
    const { Module } = await import("webp-encoder/lib/adapter.js");

    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (Module.calledRun && Module.HEAP8 && typeof Module.cwrap === "function") {
        return Module as WebPEncoderModule;
      }

      await delay(25);
    }

    throw new Error("WebP animation encoder runtime was not ready.");
  });
  return webpEncoderModulePromise;
}

function withSuppressedWebPEncoderLogs<T>(callback: () => T): T {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first === "WASM module runtime initialized" || first.startsWith("write: ")) {
      return;
    }

    originalLog(...args);
  };

  try {
    return callback();
  } finally {
    console.log = originalLog;
  }
}

async function withSuppressedWebPEncoderLogsAsync<T>(callback: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first === "WASM module runtime initialized" || first.startsWith("write: ")) {
      return;
    }

    originalLog(...args);
  };

  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

function delay(millis: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, millis));
}

function frameToCanvas(frame: RenderableFrame, tilePixels: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width * tilePixels;
  canvas.height = frame.height * tilePixels;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create media canvas.");
  }

  context.fillStyle = "#05070a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const cell of frame.cells) {
    context.fillStyle = cell.color;
    context.fillRect(cell.x * tilePixels, cell.y * tilePixels, tilePixels, tilePixels);
  }

  if (tilePixels >= 16) {
    context.strokeStyle = "rgba(0, 0, 0, 0.18)";
    context.lineWidth = 1;
    for (const cell of frame.cells) {
      context.strokeRect(cell.x * tilePixels + 0.5, cell.y * tilePixels + 0.5, tilePixels - 1, tilePixels - 1);
    }
  }

  return canvas;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

function normalizeSeed(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizePlayerCount(value: number | undefined, min: number, max: number): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : min;
  if (candidate === 0) {
    return 0;
  }

  return Math.max(min, Math.min(max, candidate));
}
