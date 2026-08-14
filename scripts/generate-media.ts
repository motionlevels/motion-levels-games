import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  animationLibrary,
  animationMediaReferences,
  animationMediaSchema,
  animationPreviewRecipe
} from "../packages/animation-runtime/src/index.ts";
import {
  gameMediaReferences,
  gameMediaSchema,
  type GameConfigOptions,
  type GameDifficulty
} from "../packages/game-sdk/src/index.ts";
import { gameCatalog } from "../packages/runtime/src/gameplayRegistry.ts";

const repoRoot = process.cwd();
const outputRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_MEDIA_DIR || path.join(repoRoot, "dist/media"));
const port = Number(process.env.MOTION_LEVELS_GAMES_MEDIA_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const server = spawn(process.execPath, [path.join(repoRoot, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: path.join(repoRoot, "apps/playground"),
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", (chunk) => process.stderr.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForServer(baseURL);
  for (const [index, manifest] of gameCatalog.entries()) {
    console.log(`Generating media ${index + 1}/${gameCatalog.length}: ${manifest.id}`);
    // Chromium retains large canvas and encoded animation allocations after a
    // page closes. A fresh process per game bounds peak memory on the shared
    // CI runner and makes every game's render environment independent.
    const scenario = manifest.preview;
    const media = await generateGameMedia(manifest.id, {
      difficulty: scenario.difficulty,
      options: scenario.options,
      playerCount: scenario.playerCount,
      seed: scenario.seed
    });
    const gameDir = path.join(outputRoot, manifest.id);
    const assets = await writeMediaAssets(gameDir, media.assets);
    await writeFile(path.join(gameDir, "metadata.json"), `${JSON.stringify({
      schema: gameMediaSchema,
      game: { id: manifest.id, label: manifest.label },
      scenario,
      configuration: {
        difficulty: media.difficulty,
        options: media.options,
        playerCount: media.playerCount,
        seed: media.seed
      },
      media: gameMediaReferences(manifest.id),
      assets
    }, null, 2)}\n`);
  }

  for (const [index, animation] of animationLibrary.entries()) {
    console.log(`Generating animation media ${index + 1}/${animationLibrary.length}: ${animation.id}`);
    const media = await generateAnimationMedia(animation.id);
    const animationDir = path.join(outputRoot, "animations", animation.id);
    const assets = await writeMediaAssets(animationDir, media.assets);
    await writeFile(path.join(animationDir, "metadata.json"), `${JSON.stringify({
      schema: animationMediaSchema,
      animation: {
        id: media.id,
        label: media.label,
        description: media.description,
        animated: media.animated,
        category: media.category,
        durationMillis: media.durationMillis,
        palette: media.palette,
        tags: media.tags
      },
      recipe: animationPreviewRecipe,
      media: animationMediaReferences(animation.id),
      assets
    }, null, 2)}\n`);
  }
} finally {
  server.kill("SIGTERM");
}

console.log(`Generated media for ${gameCatalog.length} games and ${animationLibrary.length} animations in ${outputRoot}`);

type MediaAsset = {
  kind: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  dataUrl: string;
};

type GameMediaOptions = {
  difficulty?: GameDifficulty;
  options?: GameConfigOptions;
  playerCount: number;
  seed: number;
};

type MediaBundle = {
  assets: Record<string, MediaAsset>;
};

type GameMediaBundle = MediaBundle & {
  difficulty: GameDifficulty;
  options: GameConfigOptions;
  playerCount: number;
  seed: number;
};

type AnimationMediaBundle = MediaBundle & {
  id: string;
  label: string;
  description: string;
  animated: boolean;
  category: string;
  durationMillis: number;
  palette: readonly string[];
  tags: readonly string[];
};

async function generateGameMedia(gameId: string, options: GameMediaOptions): Promise<GameMediaBundle> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.motionLevelsPlaygroundApi === "ready");
    return await page.evaluate(async ({ id, mediaOptions }) => {
      const api = (window as unknown as {
        ml?: { media(gameId: string, options: GameMediaOptions): Promise<unknown> };
      }).ml;
      if (!api) throw new Error("playground API is not ready");
      return api.media(id, mediaOptions);
    }, { id: gameId, mediaOptions: options }) as GameMediaBundle;
  } finally {
    await browser.close();
  }
}

async function generateAnimationMedia(animationId: string): Promise<AnimationMediaBundle> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.motionLevelsPlaygroundApi === "ready");
    return await page.evaluate(async (id) => {
      const api = (window as unknown as { ml?: { animationMedia(animationId: string): Promise<unknown> } }).ml;
      if (!api) throw new Error("playground API is not ready");
      return api.animationMedia(id);
    }, animationId) as AnimationMediaBundle;
  } finally {
    await browser.close();
  }
}

async function writeMediaAssets(directory: string, mediaAssets: Record<string, MediaAsset>): Promise<Record<string, unknown>> {
  await mkdir(directory, { recursive: true });
  const assets: Record<string, unknown> = {};
  for (const asset of Object.values(mediaAssets)) {
    const contents = dataUrlBytes(asset.dataUrl);
    await writeFile(path.join(directory, asset.fileName), contents);
    assets[asset.kind] = {
      file: asset.fileName,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex")
    };
  }
  return assets;
}

function dataUrlBytes(dataUrl: string): Buffer {
  const separator = dataUrl.indexOf(",");
  if (separator < 0 || !dataUrl.slice(0, separator).endsWith(";base64")) throw new Error("expected a base64 data URL");
  return Buffer.from(dataUrl.slice(separator + 1), "base64");
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`playground preview exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while Vite starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}
