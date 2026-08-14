import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
  animationMediaReferences,
  animationMediaSchema,
  animationPreviewRecipe,
  findAnimation,
  renderAnimationFrame,
  type AnimationMediaCatalogEntry
} from "@motion-levels-games/animation-runtime";
import {
  DEFAULT_ENGINE_FPS,
  DEFAULT_GAME_SEED,
  createGameEngine,
  defaultGamePlayerCount,
  fileNameFromMediaReference,
  gameMediaAssetSpecs,
  gameMediaPreviewStillFrameIndex,
  gameMediaReferences,
  gameMediaSchema,
  normalizeGameConfig,
  type FloorGameMediaAssetKind,
  type GameConfig,
  type GameConfigOptions,
  type GameConfigPlayer,
  type GameEngine,
  type GameDifficulty,
  type GameMediaAssetKind,
  type GameMediaReferences
} from "@motion-levels-games/game-sdk";
import type { PlaygroundGame } from "./gameRegistry.ts";
import { rotateFrameClockwise, type RenderableFrame } from "./frameTransforms.ts";
import { loadDataUrlImage } from "./imageLoading.ts";
import {
  collectPreviewFrames,
  type PlayerDisplayMediaFrame,
  type PreviewFrame
} from "./previewCapture.ts";

export { collectPreviewFrames, type PlayerDisplayMediaFrame, type PreviewFrame } from "./previewCapture.ts";

export type PlaygroundMediaAssetKind = GameMediaAssetKind;

export type PlaygroundMediaAsset = {
  kind: PlaygroundMediaAssetKind;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  dataUrl: string;
};

export type PlaygroundMediaBundle = {
  schema: typeof gameMediaSchema;
  gameId: string;
  label: string;
  difficulty: GameDifficulty;
  options: GameConfigOptions;
  seed: number;
  playerCount: number;
  generatedAt: string;
  media: GameMediaReferences;
  assets: Record<PlaygroundMediaAssetKind, PlaygroundMediaAsset>;
};

export type AnimationMediaBundle = AnimationMediaCatalogEntry & {
  schema: typeof animationMediaSchema;
  seed: number;
  assets: Pick<PlaygroundMediaBundle["assets"], "thumbnailSmall" | "thumbnail" | "animation">;
};

export type PlaygroundMediaOptions = {
  difficulty?: GameDifficulty;
  options?: GameConfigOptions;
  players?: GameConfigPlayer[];
  seed?: number;
  playerCount?: number;
};

export type PlayerDisplayAssetRenderer = (input: {
  animationFileName: string;
  fileName: string;
  frames: PlayerDisplayMediaFrame[];
  game: PlaygroundGame;
}) => Promise<Pick<PlaygroundMediaBundle["assets"], "playerDisplay" | "playerDisplayAnimation">>;

type WebPEncoderModule = {
  HEAP8: Int8Array;
  calledRun?: boolean;
  cwrap: (name: string, returnType: string, argTypes: string[]) => (...args: number[]) => number;
};

let webpEncoderModulePromise: Promise<WebPEncoderModule> | null = null;

export async function generateGameMediaBundle(
  game: PlaygroundGame,
  renderPlayerDisplay: PlayerDisplayAssetRenderer,
  options: PlaygroundMediaOptions = {}
): Promise<PlaygroundMediaBundle> {
  const preview = game.manifest.preview;
  const config = normalizeGameConfig({
    seed: options.seed ?? preview.seed ?? DEFAULT_GAME_SEED,
    playerCount: options.playerCount ?? preview.playerCount ?? defaultGamePlayerCount(game.manifest),
    difficulty: options.difficulty ?? preview.difficulty,
    options: options.options ?? preview.options,
    players: options.players
  }, game.manifest);
  const engine = createPreviewEngine(game, config);
  const frames = collectPreviewFrames(engine, preview);
  const stillFrame = frames[Math.min(gameMediaPreviewStillFrameIndex, frames.length - 1)]?.frame
    ?? rotateFrameClockwise(engine.state.frame);
  const media = gameMediaReferences(game.manifest.id);
  const playerDisplayAssets = await renderPlayerDisplay({
    animationFileName: fileNameFromMediaReference(media.playerDisplayAnimation),
    fileName: fileNameFromMediaReference(media.playerDisplay),
    frames: frames.map((frame) => frame.display),
    game
  });

  return {
    schema: gameMediaSchema,
    gameId: game.manifest.id,
    label: game.manifest.label,
    difficulty: config.difficulty,
    options: config.options,
    seed: config.seed,
    playerCount: config.playerCount,
    generatedAt: new Date().toISOString(),
    media,
    assets: {
      thumbnailSmall: frameToImageAsset(stillFrame, {
        fileName: fileNameFromMediaReference(media.thumbnailSmall),
        kind: "thumbnailSmall",
        quality: 0.45
      }),
      thumbnail: frameToImageAsset(stillFrame, {
        fileName: fileNameFromMediaReference(media.thumbnail),
        kind: "thumbnail",
        quality: 0.92
      }),
      animation: await framesToAnimatedWebpAsset(frames, fileNameFromMediaReference(media.animation)),
      ...playerDisplayAssets
    }
  };
}

export async function generateAnimationMediaBundle(animationId: string): Promise<AnimationMediaBundle> {
  const animation = findAnimation(animationId);
  if (animation.id !== animationId.trim().toLowerCase()) {
    throw new Error(`Unknown native animation: ${animationId}`);
  }
  const references = animationMediaReferences(animation.id);
  const frames = Array.from({ length: animationPreviewRecipe.frameCount }, (_, index) => {
    const atMillis = animationPreviewRecipe.captureStartMillis + index * animationPreviewRecipe.frameIntervalMillis;
    return {
      delayMs: animationPreviewRecipe.frameIntervalMillis,
      frame: rotateFrameClockwise(renderAnimationFrame(animation, {
        atMillis,
        seed: animationPreviewRecipe.seed,
        pressure: [animationPreviewRecipe.pressure]
      }))
    };
  });
  const stillFrame = frames[animationPreviewRecipe.stillFrameIndex]?.frame ?? frames[0]?.frame;
  if (!stillFrame) {
    throw new Error(`Animation ${animation.id} did not produce preview frames.`);
  }

  return {
    schema: animationMediaSchema,
    id: animation.id,
    label: animation.label,
    description: animation.description,
    category: animation.category,
    durationMillis: animation.durationMillis,
    palette: animation.palette,
    tags: animation.tags,
    media: references,
    seed: animationPreviewRecipe.seed,
    assets: {
      thumbnailSmall: frameToImageAsset(stillFrame, {
        fileName: fileNameFromMediaReference(references.thumbnailSmall),
        kind: "thumbnailSmall",
        quality: 0.45
      }),
      thumbnail: frameToImageAsset(stillFrame, {
        fileName: fileNameFromMediaReference(references.thumbnail),
        kind: "thumbnail",
        quality: 0.92
      }),
      animation: await framesToAnimatedWebpAsset(
        frames,
        fileNameFromMediaReference(references.animation)
      )
    }
  };
}

function createPreviewEngine(
  game: PlaygroundGame,
  config: Pick<GameConfig, "difficulty" | "options" | "playerCount" | "players" | "seed">
): GameEngine {
  const instance = game.createGame({
    seed: config.seed,
    playerCount: config.playerCount,
    players: config.players,
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

function floorTilePixels(frame: RenderableFrame, kind: FloorGameMediaAssetKind): number {
  const spec = gameMediaAssetSpecs[kind];
  const horizontalScale = spec.width / frame.width;
  const verticalScale = spec.height / frame.height;
  if (!Number.isInteger(horizontalScale) || horizontalScale !== verticalScale) {
    throw new Error(
      `${kind} ${spec.width}x${spec.height} is incompatible with frame ${frame.width}x${frame.height}.`
    );
  }
  return horizontalScale;
}

function frameToImageAsset(
  frame: RenderableFrame,
  options: {
    fileName: string;
    kind: FloorGameMediaAssetKind;
    quality?: number;
  }
): PlaygroundMediaAsset {
  const spec = gameMediaAssetSpecs[options.kind];
  const canvas = frameToCanvas(frame, floorTilePixels(frame, options.kind));
  const dataUrl = canvas.toDataURL(spec.mimeType, options.quality);
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

async function framesToAnimatedWebpAsset(
  frames: Array<Pick<PreviewFrame, "delayMs" | "frame">>,
  fileName: string
): Promise<PlaygroundMediaAsset> {
  const first = frames[0]?.frame;
  if (!first) {
    throw new Error("Cannot render an animation without frames.");
  }

  const spec = gameMediaAssetSpecs.animation;
  const tilePixels = floorTilePixels(first, "animation");
  const { width, height } = spec;
  const encoder = GIFEncoder();

  for (const frame of frames) {
    const canvas = frameToCanvas(frame.frame, tilePixels);
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

export async function imagesToAnimatedWebpAsset(
  frames: Array<{ dataUrl: string; delayMs: number }>,
  fileName: string
): Promise<PlaygroundMediaAsset> {
  if (frames.length === 0) {
    throw new Error("Cannot render a player display animation without frames.");
  }

  const { width, height } = gameMediaAssetSpecs.playerDisplayAnimation;
  const encoder = GIFEncoder();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create player display animation canvas.");
  }

  for (const frame of frames) {
    const image = await loadDataUrlImage(frame.dataUrl, "Could not load player display animation frame.");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, width, height, { delay: frame.delayMs, palette });
  }

  encoder.finish();
  const webpBytes = await encodeGifBytesToWebp(encoder.bytesView());
  return {
    kind: "playerDisplayAnimation",
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
