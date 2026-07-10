import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { c as createTar } from "tar";
import { DEFAULT_ENGINE_FPS } from "../packages/game-sdk/src/index.ts";
import { runnerProtocolVersion } from "../packages/runner/src/protocol.ts";
import { gameCatalog } from "../packages/runner/src/registry.ts";
import { bundleContentDigest, bundleFiles } from "./bundle-files.ts";

const repoRoot = process.cwd();
const sourceRevision = String(process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION || execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })).trim();
if (!/^[0-9a-f]{40}$/u.test(sourceRevision)) throw new Error(`invalid source revision: ${sourceRevision}`);
const outputRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_BUNDLE_DIR || path.join(repoRoot, "dist/bundle"));
const mediaRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_MEDIA_DIR || path.join(repoRoot, "dist/media"));
const displayCSS = await readFile(path.join(repoRoot, "packages/display-kit/src/styles.css"), "utf8");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "runtime"), { recursive: true });
await mkdir(path.join(outputRoot, "display"), { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "packages/runner/src/runner.ts")],
  outfile: path.join(outputRoot, "runtime/runner.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  define: { MOTION_LEVELS_GAMES_REVISION: JSON.stringify(sourceRevision) },
  sourcemap: false,
  legalComments: "none"
});
await build({
  entryPoints: [path.join(repoRoot, "packages/runner/src/display.tsx")],
  outfile: path.join(outputRoot, "display/display.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  define: {
    MOTION_LEVELS_GAMES_REVISION: JSON.stringify(sourceRevision),
    MOTION_LEVELS_GAMES_DISPLAY_CSS: JSON.stringify(displayCSS)
  },
  minify: true,
  sourcemap: false,
  legalComments: "none"
});

for (const manifest of gameCatalog.filter((game) => game.availability.production)) {
  await stat(path.join(mediaRoot, manifest.id, `${manifest.id}-thumbnail.webp`));
  await stat(path.join(mediaRoot, manifest.id, `${manifest.id}-preview.webp`));
  await stat(path.join(mediaRoot, manifest.id, `${manifest.id}-player-display.webp`));
}
await cp(mediaRoot, path.join(outputRoot, "media"), { recursive: true });

const catalog = gameCatalog.map((manifest) => ({
  ...manifest,
  engineGame: `motion-levels-games:${manifest.id}`,
  media: {
    thumbnailSmall: `media/${manifest.id}/${manifest.id}-thumbnail-small.webp`,
    thumbnail: `media/${manifest.id}/${manifest.id}-thumbnail.webp`,
    animation: `media/${manifest.id}/${manifest.id}-preview.webp`,
    playerDisplay: `media/${manifest.id}/${manifest.id}-player-display.webp`
  }
}));
await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

const files = await bundleFiles(outputRoot);
const artifactDigest = bundleContentDigest(files);
const manifest = {
  schema: "motion-levels-games-bundle-v1",
  contractVersion: 1,
  runnerProtocolVersion,
  sourceRevision,
  sdkFps: DEFAULT_ENGINE_FPS,
  artifactDigest,
  runtime: { entry: "runtime/runner.mjs", games: catalog.filter((game) => game.availability.production).map((game) => game.id) },
  playerDisplay: { entry: "display/display.js", games: catalog.filter((game) => game.availability.production).map((game) => game.id) },
  catalog: "catalog.json",
  files
};
await writeFile(path.join(outputRoot, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const archivePath = path.join(repoRoot, "dist", `motion-levels-games-${sourceRevision}.tgz`);
await createTar({ cwd: outputRoot, file: archivePath, gzip: true, portable: true, mtime: new Date(0) }, ["."]);
const archive = await readFile(archivePath);
await writeFile(`${archivePath}.sha256`, `${createHash("sha256").update(archive).digest("hex")}  ${path.basename(archivePath)}\n`);
console.log(JSON.stringify({ archivePath, artifactDigest, files: files.length, sourceRevision }, null, 2));
