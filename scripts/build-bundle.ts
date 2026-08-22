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
import { resolveGamesBuildIdentity } from "./build-version.ts";
import { bundleContentDigest, bundleFiles } from "./bundle-files.ts";
import { authoredContentBundleSchema, compileAuthoredContent } from "./authored-content.ts";

const repoRoot = process.cwd();
const sourceRevision = String(process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION || execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })).trim();
if (!/^[0-9a-f]{40}$/u.test(sourceRevision)) throw new Error(`invalid source revision: ${sourceRevision}`);
const { buildVersion, releaseTag } = resolveGamesBuildIdentity(sourceRevision, { cwd: repoRoot });
const sourceBuildDate = execFileSync("git", ["show", "-s", "--format=%cI", sourceRevision], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();
const outputRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_BUNDLE_DIR || path.join(repoRoot, "dist/bundle"));
const defaultDistMedia = path.join(repoRoot, "dist/media");
const defaultSubmoduleMedia = path.join(repoRoot, "assets/media");
let resolvedMediaRoot = defaultDistMedia;
if (process.env.MOTION_LEVELS_GAMES_MEDIA_DIR) {
  resolvedMediaRoot = path.resolve(process.env.MOTION_LEVELS_GAMES_MEDIA_DIR);
} else {
  try {
    const s = await stat(defaultDistMedia);
    if (!s.isDirectory()) throw new Error();
  } catch {
    try {
      const s = await stat(defaultSubmoduleMedia);
      if (s.isDirectory()) resolvedMediaRoot = defaultSubmoduleMedia;
    } catch {
      // fallback to default dist/media
    }
  }
}
const mediaRoot = resolvedMediaRoot;
const playerExperienceSchema = await readFile(path.join(repoRoot, "packages/player-experience/schema/player-experience-state.schema.json"), "utf8");
const sessionHistorySchema = await readFile(path.join(repoRoot, "packages/session-history/schema/session-history-v1.schema.json"), "utf8");
const authoredGames = await compileAuthoredContent({ root: repoRoot });

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "venue"), { recursive: true });
await mkdir(path.join(outputRoot, "display"), { recursive: true });
await mkdir(path.join(outputRoot, "content"), { recursive: true });
const applicationBuildEnvironment = {
  ...process.env,
  MOTION_LEVELS_BUILD_DATE: sourceBuildDate,
  MOTION_LEVELS_BUILD_REVISION: sourceRevision,
  MOTION_LEVELS_GAMES_SOURCE_REVISION: sourceRevision,
  ...(releaseTag === null ? {} : { MOTION_LEVELS_GAMES_RELEASE_TAG: releaseTag })
};
for (const workspace of [
  "@motion-levels-games/player-menu",
  "@motion-levels-games/player-display"
]) {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "run",
    "build",
    "--workspace",
    workspace
  ], {
    cwd: repoRoot,
    env: applicationBuildEnvironment,
    stdio: "inherit"
  });
}
await stat(path.join(repoRoot, "apps/player-menu/dist/index.html"));
await stat(path.join(repoRoot, "apps/player-menu/dist/build.json"));
await cp(path.join(repoRoot, "apps/player-menu/dist"), path.join(outputRoot, "menu"), { recursive: true });
await stat(path.join(repoRoot, "apps/player-display/dist/index.html"));
await stat(path.join(repoRoot, "apps/player-display/dist/build.json"));
await cp(path.join(repoRoot, "apps/player-display/dist"), path.join(outputRoot, "display"), { recursive: true });
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "run",
  "build",
  "--workspace",
  "@motion-levels-games/playground",
], {
  cwd: repoRoot,
  env: {
    ...applicationBuildEnvironment,
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
const displayBuildOptions = {
  entryPoints: [path.join(repoRoot, "packages/runtime/src/display.tsx")],
  outfile: path.join(outputRoot, "display/display.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  define: {
    MOTION_LEVELS_GAMES_REVISION: JSON.stringify(sourceRevision),
    MOTION_LEVELS_GAMES_DISPLAY_CSS: JSON.stringify("")
  },
  loader: { ".png": "dataurl" },
  minify: true,
  sourcemap: false,
  legalComments: "none"
} satisfies Parameters<typeof build>[0];
const provisionalDisplayBuild = await build({ ...displayBuildOptions, write: false });
const provisionalDisplayStyles = provisionalDisplayBuild.outputFiles?.find((file) => file.path.endsWith(".css"));
if (!provisionalDisplayStyles) throw new Error("player display build did not emit its stylesheet");
const embeddedDisplayStyles = Buffer.from(provisionalDisplayStyles.contents).toString("utf8");
await build({
  ...displayBuildOptions,
  define: {
    MOTION_LEVELS_GAMES_REVISION: JSON.stringify(sourceRevision),
    MOTION_LEVELS_GAMES_DISPLAY_CSS: JSON.stringify(embeddedDisplayStyles)
  }
});
await stat(path.join(outputRoot, "display/display.css"));

const mediaSources = new Map<string, string>();
async function registerMedia(reference: string): Promise<void> {
  const relative = path.relative("media", reference);
  const direct = path.join(mediaRoot, relative);
  try {
    await stat(direct);
    mediaSources.set(reference, direct);
    return;
  } catch {
    // The checked-in assets submodule keeps game media under media/games while
    // generated-media artifacts use the flatter media/<game> layout. Both
    // resolve to the canonical bundle reference below.
  }
  const submoduleGameMedia = path.join(mediaRoot, "games", relative);
  await stat(submoduleGameMedia);
  mediaSources.set(reference, submoduleGameMedia);
}

for (const manifest of gameCatalog) {
  for (const reference of Object.values(gameMediaReferences(manifest.id))) await registerMedia(reference);
  await registerMedia(gameMediaMetadataReference(manifest.id));
}
for (const animation of animationLibrary) {
  const media = animationMediaCatalogEntry(animation).media;
  await registerMedia(media.thumbnailSmall);
  await registerMedia(media.thumbnail);
  await registerMedia(media.animation);
  await registerMedia(animationMediaMetadataReference(animation.id));
}
for (const [reference, source] of mediaSources) {
  const destination = path.join(outputRoot, reference);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

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
for (const authored of authoredGames) {
  await cp(authored.outputPath, path.join(outputRoot, "content", `${authored.gameDir}.json`));
}
await writeFile(path.join(outputRoot, "player-experience-state.schema.json"), `${JSON.stringify(JSON.parse(playerExperienceSchema), null, 2)}\n`);
await writeFile(path.join(outputRoot, "session-history-v1.schema.json"), `${JSON.stringify(JSON.parse(sessionHistorySchema), null, 2)}\n`);

const files = await bundleFiles(outputRoot);
const artifactDigest = bundleContentDigest(files);
const manifest = {
  schema: "motion-levels-games-bundle-v2",
  contractVersion: 2,
  sourceRevision,
  buildVersion,
  releaseTag,
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
    styleEntry: "display/display.css",
    shellEntry: "display/index.html",
    buildManifest: "display/build.json",
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
  authoredContent: {
    schema: authoredContentBundleSchema,
    games: authoredGames.map((authored) => ({
      gameId: authored.game.gameId,
      engineGame: authored.game.engineGame,
      contentRevision: authored.content.contentRevision,
      path: `content/${authored.gameDir}.json`
    }))
  },
  files
};
await writeFile(path.join(outputRoot, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const archivePath = path.join(repoRoot, "dist", `motion-levels-games-${sourceRevision}.tgz`);
await createTar({ cwd: outputRoot, file: archivePath, gzip: true, portable: true, mtime: new Date(0) }, ["."]);
const archive = await readFile(archivePath);
await writeFile(`${archivePath}.sha256`, `${createHash("sha256").update(archive).digest("hex")}  ${path.basename(archivePath)}\n`);
console.log(JSON.stringify({ archivePath, artifactDigest, files: files.length, sourceRevision, buildVersion, releaseTag }, null, 2));
