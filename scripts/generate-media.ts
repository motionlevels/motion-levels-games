import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { gameCatalog } from "../packages/runner/src/registry.ts";

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
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.motionLevelsPlaygroundApi === "ready");

    for (const manifest of gameCatalog) {
      const media = await page.evaluate(async (gameId) => {
        const api = (window as unknown as { ml?: { media(id: string): Promise<unknown> } }).ml;
        if (!api) throw new Error("playground API is not ready");
        return api.media(gameId);
      }, manifest.id) as MediaBundle;
      const gameDir = path.join(outputRoot, manifest.id);
      await mkdir(gameDir, { recursive: true });
      const assets: Record<string, unknown> = {};
      for (const asset of Object.values(media.assets)) {
        const contents = dataUrlBytes(asset.dataUrl);
        await writeFile(path.join(gameDir, asset.fileName), contents);
        assets[asset.kind] = {
          file: asset.fileName,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
          bytes: contents.length,
          sha256: createHash("sha256").update(contents).digest("hex")
        };
      }
      await writeFile(path.join(gameDir, "metadata.json"), `${JSON.stringify({
        gameId: manifest.id,
        scenario: manifest.preview,
        assets
      }, null, 2)}\n`);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

console.log(`Generated media for ${gameCatalog.length} games in ${outputRoot}`);

type MediaAsset = {
  kind: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  dataUrl: string;
};

type MediaBundle = { assets: Record<string, MediaAsset> };

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
