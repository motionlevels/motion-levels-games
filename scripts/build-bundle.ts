import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { c as createTar } from "tar";
import {
  animationLibrary,
  animationMediaCatalogEntry,
  animationMediaMetadataReference,
  animationMediaSchema,
  animationPreviewRecipe
} from "../packages/animation-runtime/src/index.ts";
import {
  DEFAULT_ENGINE_FPS,
  gameMediaMetadataReference,
  gameMediaReferences
} from "../packages/game-sdk/src/index.ts";
import { controllerProtocolVersion } from "../apps/venue-runtime/src/controllerProtocol.ts";
import { venueApiProtocolVersion } from "../apps/venue-runtime/src/apiProtocol.ts";
import { gameCatalog } from "../packages/runtime/src/gameplayRegistry.ts";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA
} from "../packages/session-history/src/index.ts";
import { playerMenuAdapterProtocolVersion } from "../apps/player-menu/src/protocol.ts";
import { bundleContentDigest, bundleFiles } from "./bundle-files.ts";

const repoRoot = process.cwd();
const sourceRevision = String(process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION || execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })).trim();
if (!/^[0-9a-f]{40}$/u.test(sourceRevision)) throw new Error(`invalid source revision: ${sourceRevision}`);
const sourceBuildDate = execFileSync("git", ["show", "-s", "--format=%cI", sourceRevision], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();
const outputRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_BUNDLE_DIR || path.join(repoRoot, "dist/bundle"));
const mediaRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_MEDIA_DIR || path.join(repoRoot, "dist/media"));
const displayCSSSource = await readFile(path.join(repoRoot, "packages/display-kit/src/styles.css"), "utf8");
const displayLogo = await readFile(path.join(repoRoot, "packages/display-kit/src/assets/motion-levels-icon.png"));
const displayLogoReference = 'url("./assets/motion-levels-icon.png")';
if (!displayCSSSource.includes(displayLogoReference)) {
  throw new Error("player display CSS is missing the Motion Levels logo reference");
}
const displayCSS = displayCSSSource.replace(
  displayLogoReference,
  `url("data:image/png;base64,${displayLogo.toString("base64")}")`
);
const playerExperienceSchema = await readFile(path.join(repoRoot, "packages/player-experience/schema/player-experience-state.schema.json"), "utf8");
const sessionHistorySchema = await readFile(path.join(repoRoot, "packages/session-history/schema/session-history-v1.schema.json"), "utf8");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "venue"), { recursive: true });
await mkdir(path.join(outputRoot, "display"), { recursive: true });
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "run",
  "build",
  "--workspace",
  "@motion-levels-games/player-menu",
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MOTION_LEVELS_BUILD_DATE: sourceBuildDate,
    MOTION_LEVELS_BUILD_REVISION: sourceRevision,
    MOTION_LEVELS_GAMES_SOURCE_REVISION: sourceRevision
  },
  stdio: "inherit"
});
await stat(path.join(repoRoot, "apps/player-menu/dist/index.html"));
await stat(path.join(repoRoot, "apps/player-menu/dist/build.json"));
await cp(path.join(repoRoot, "apps/player-menu/dist"), path.join(outputRoot, "menu"), { recursive: true });
await stat(path.join(repoRoot, "apps/player-display/dist/index.html"));
await cp(path.join(repoRoot, "apps/player-display/dist"), path.join(outputRoot, "display"), { recursive: true });
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "run",
  "build",
  "--workspace",
  "@motion-levels-games/playground",
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MOTION_LEVELS_BUILD_REVISION: sourceRevision,
    MOTION_LEVELS_GAMES_SOURCE_REVISION: sourceRevision,
    VITE_HOSTED_PLAYER_EXPERIENCE: "true",
    VITE_PLAYGROUND_BASE: "/games/play/",
    VITE_POSTHOG_ENABLED: "false",
  },
  stdio: "inherit",
});
await stat(path.join(repoRoot, "apps/playground/dist/index.html"));
await cp(path.join(repoRoot, "apps/playground/dist"), path.join(outputRoot, "playground"), { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "apps/venue-runtime/src/main.ts")],
  outfile: path.join(outputRoot, "venue/runtime.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  define: { MOTION_LEVELS_GAMES_REVISION: JSON.stringify(sourceRevision) },
  sourcemap: false,
  legalComments: "none"
});
await build({
  entryPoints: [path.join(repoRoot, "packages/runtime/src/display.tsx")],
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

for (const manifest of gameCatalog) {
  for (const reference of Object.values(gameMediaReferences(manifest.id))) {
    await stat(path.join(mediaRoot, path.relative("media", reference)));
  }
  await stat(path.join(mediaRoot, path.relative("media", gameMediaMetadataReference(manifest.id))));
}
for (const animation of animationLibrary) {
  const media = animationMediaCatalogEntry(animation).media;
  await stat(path.join(mediaRoot, path.relative("media", media.thumbnailSmall)));
  await stat(path.join(mediaRoot, path.relative("media", media.thumbnail)));
  await stat(path.join(mediaRoot, path.relative("media", media.animation)));
  await stat(path.join(mediaRoot, path.relative("media", animationMediaMetadataReference(animation.id))));
}
await cp(mediaRoot, path.join(outputRoot, "media"), { recursive: true });

const catalog = gameCatalog.map((manifest) => ({
  ...manifest,
  engineGame: `motion-levels-games:${manifest.id}`,
  media: gameMediaReferences(manifest.id)
}));
await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

const animationCatalog = {
  schema: animationMediaSchema,
  recipe: animationPreviewRecipe,
  animations: animationLibrary.map(animationMediaCatalogEntry)
};
await writeFile(path.join(outputRoot, "animations.json"), `${JSON.stringify(animationCatalog, null, 2)}\n`);
await writeFile(path.join(outputRoot, "player-experience-state.schema.json"), `${JSON.stringify(JSON.parse(playerExperienceSchema), null, 2)}\n`);
await writeFile(path.join(outputRoot, "session-history-v1.schema.json"), `${JSON.stringify(JSON.parse(sessionHistorySchema), null, 2)}\n`);

const files = await bundleFiles(outputRoot);
const artifactDigest = bundleContentDigest(files);
const manifest = {
  schema: "motion-levels-games-bundle-v2",
  contractVersion: 2,
  sourceRevision,
  sdkFps: DEFAULT_ENGINE_FPS,
  artifactDigest,
  venueRuntime: {
    entry: "venue/runtime.mjs",
    apiProtocolVersion: venueApiProtocolVersion,
    controllerProtocolVersion,
    games: catalog.filter((game) => game.availability.production).map((game) => game.id)
  },
  playerDisplay: {
    entry: "display/display.js",
    shellEntry: "display/index.html",
    games: catalog.filter((game) => game.availability.production).map((game) => game.id)
  },
  playerMenu: {
    entry: "menu/index.html",
    buildManifest: "menu/build.json",
    adapterProtocolVersion: playerMenuAdapterProtocolVersion
  },
  playerExperience: { contractVersion: 1, schema: "player-experience-state.schema.json" },
  sessionHistory: {
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    schemaId: SESSION_HISTORY_SCHEMA,
    schema: "session-history-v1.schema.json"
  },
  playground: { entry: "playground/index.html", basePath: "/games/play/" },
  catalog: "catalog.json",
  animations: "animations.json",
  files
};
await writeFile(path.join(outputRoot, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const archivePath = path.join(repoRoot, "dist", `motion-levels-games-${sourceRevision}.tgz`);
await createTar({ cwd: outputRoot, file: archivePath, gzip: true, portable: true, mtime: new Date(0) }, ["."]);
const archive = await readFile(archivePath);
await writeFile(`${archivePath}.sha256`, `${createHash("sha256").update(archive).digest("hex")}  ${path.basename(archivePath)}\n`);
console.log(JSON.stringify({ archivePath, artifactDigest, files: files.length, sourceRevision }, null, 2));
