import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  animationLibrary,
  animationMediaMetadataReference,
  animationMediaReferences,
  animationMediaSchema,
  animationPreviewRecipe
} from "../packages/animation-runtime/src/index.ts";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA
} from "../packages/session-history/src/index.ts";
import {
  gameMediaAssetSpecs,
  gameMediaMetadataReference,
  gameMediaReferences,
  gameMediaSchema,
  normalizeGameConfig,
  type GameMediaAssetKind
} from "../packages/game-sdk/src/index.ts";
import { gameCatalog } from "../packages/game-catalog/src/gameplayRegistry.ts";
import { deriveGamesBuildIdentity } from "./build-version.ts";
import { bundleContentDigest, bundleFiles } from "./bundle-files.ts";

const root = path.resolve(process.env.MOTION_LEVELS_GAMES_BUNDLE_DIR || path.join(process.cwd(), "dist/bundle"));
const manifest = JSON.parse(await readFile(path.join(root, "bundle.json"), "utf8")) as {
  schema?: string;
  contractVersion?: number;
  venueRuntime?: { entry?: string; apiProtocolVersion?: number; controllerProtocolVersion?: number; games?: string[] };
  playerMenu?: { entry?: string; buildManifest?: string; adapterProtocolVersion?: number };
  playerExperience?: { contractVersion?: number; schema?: string };
  sessionHistory?: { contractVersion?: number; schemaId?: string; schema?: string };
  playerDisplay?: { entry?: string; styleEntry?: string; shellEntry?: string; buildManifest?: string; games?: string[] };
  playground?: { entry?: string; basePath?: string };
  catalog?: string;
  animations?: string;
  authoredContent?: {
    schema?: string;
    games?: Array<{ gameId?: string; engineGame?: string; contentRevision?: string; path?: string }>;
  };
  sourceRevision?: string;
  buildVersion?: string;
  releaseTag?: string | null;
  sdkFps?: number;
  artifactDigest?: string;
  files?: unknown[];
};
assert.equal(manifest.schema, "motion-levels-games-bundle-v2");
assert.equal(manifest.contractVersion, 2);
assert.equal(manifest.venueRuntime?.entry, "venue/runtime.mjs");
assert.equal(manifest.venueRuntime?.apiProtocolVersion, 1);
assert.equal(manifest.venueRuntime?.controllerProtocolVersion, 2);
assert.ok((manifest.venueRuntime?.games?.length ?? 0) > 0);
assert.equal(manifest.playerDisplay?.entry, "display/display.js");
assert.equal(manifest.playerDisplay?.styleEntry, "display/display.css");
assert.equal(manifest.playerDisplay?.shellEntry, "display/index.html");
assert.equal(manifest.playerDisplay?.buildManifest, "display/build.json");
assert.deepEqual(manifest.playerDisplay?.games, manifest.venueRuntime?.games);
assert.equal(manifest.playerMenu?.entry, "menu/index.html");
assert.equal(manifest.playerMenu?.buildManifest, "menu/build.json");
assert.equal(manifest.playerMenu?.adapterProtocolVersion, 2);
assert.equal(manifest.playerExperience?.contractVersion, 1);
assert.equal(manifest.playerExperience?.schema, "player-experience-state.schema.json");
assert.equal(manifest.sessionHistory?.contractVersion, SESSION_HISTORY_CONTRACT_VERSION);
assert.equal(manifest.sessionHistory?.schemaId, SESSION_HISTORY_SCHEMA);
assert.equal(manifest.sessionHistory?.schema, "session-history-v1.schema.json");
assert.equal(manifest.playground?.entry, "playground/index.html");
assert.equal(manifest.playground?.basePath, "/games/play/");
assert.equal(manifest.catalog, "catalog.json");
assert.equal(manifest.animations, "animations.json");
assert.equal(manifest.authoredContent?.schema, "motion-levels-authored-content-bundle-v1");
assert.equal(manifest.sdkFps, 50);
assert.match(String(manifest.sourceRevision), /^[0-9a-f]{40}$/u);
assert.ok("buildVersion" in manifest, "bundle build version is missing");
assert.ok("releaseTag" in manifest, "bundle release tag metadata is missing");
const expectedBuildIdentity = manifest.releaseTag === null
  ? deriveGamesBuildIdentity(manifest.sourceRevision!)
  : deriveGamesBuildIdentity(manifest.sourceRevision!, { explicitReleaseTag: String(manifest.releaseTag) });
assert.equal(manifest.buildVersion, expectedBuildIdentity.buildVersion);
assert.equal(manifest.releaseTag, expectedBuildIdentity.releaseTag);
assert.equal("runtime" in manifest, false);
const files = await bundleFiles(root);
assert.ok(files.some((file) => file.path === manifest.venueRuntime?.entry), "venue runtime entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerDisplay?.entry), "player display entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerDisplay?.styleEntry), "player display stylesheet is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerDisplay?.shellEntry), "player display shell is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerDisplay?.buildManifest), "player display build manifest is missing from bundle files");
const audioTestSamplePath = "display/audio/probando.wav";
assert.ok(files.some((file) => file.path === audioTestSamplePath), "player display audio diagnostic is missing from bundle files");
const audioTestSample = await readFile(path.join(root, audioTestSamplePath));
assert.equal(audioTestSample.subarray(0, 4).toString("ascii"), "RIFF", "audio diagnostic is not a WAV file");
assert.equal(audioTestSample.subarray(8, 12).toString("ascii"), "WAVE", "audio diagnostic has no WAVE signature");
assert.ok(files.some((file) => file.path === manifest.playerMenu?.entry), "player menu entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerMenu?.buildManifest), "player menu build manifest is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playground?.entry), "playground entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.animations), "animation catalog is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.catalog), "game catalog is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerExperience?.schema), "player experience schema is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.sessionHistory?.schema), "session history schema is missing from bundle files");
assert.ok((manifest.authoredContent?.games?.length ?? 0) > 0, "authored content catalog is empty");
for (const authored of manifest.authoredContent?.games ?? []) {
  assert.match(String(authored.gameId), /^[0-9a-f-]{36}$/u);
  assert.match(String(authored.contentRevision), /^[0-9a-f]{64}$/u);
  assert.ok(files.some((file) => file.path === authored.path), `${authored.engineGame} authored content is missing`);
  const content = JSON.parse(await readFile(path.join(root, String(authored.path)), "utf8")) as {
    schema?: string;
    gameId?: string;
    engineGame?: string;
    contentRevision?: string;
    levels?: unknown[];
  };
  assert.equal(content.schema, "motion-levels-published-level-content-v1");
  assert.equal(content.gameId, authored.gameId);
  assert.equal(content.engineGame, authored.engineGame);
  assert.equal(content.contentRevision, authored.contentRevision);
  assert.ok((content.levels?.length ?? 0) > 0, `${authored.engineGame} authored content has no levels`);
}

const sessionHistorySchema = JSON.parse(
  await readFile(path.join(root, manifest.sessionHistory!.schema!), "utf8")
) as {
  $ref?: string;
  $defs?: Record<string, { properties?: Record<string, { const?: unknown }> }>;
};
assert.equal(sessionHistorySchema.$ref, "#/$defs/visit");
assert.equal(sessionHistorySchema.$defs?.visit?.properties?.schema?.const, SESSION_HISTORY_SCHEMA);
assert.equal(
  sessionHistorySchema.$defs?.visit?.properties?.contractVersion?.const,
  SESSION_HISTORY_CONTRACT_VERSION
);

const menuBuild = JSON.parse(await readFile(path.join(root, manifest.playerMenu!.buildManifest!), "utf8")) as {
  schema?: string;
  menuBuildRevision?: string;
  menuBuildDate?: string;
  gamesSourceRevision?: string;
  buildVersion?: string;
  releaseTag?: string | null;
};
assert.equal(menuBuild.schema, "motion-levels-player-menu-build-v1");
assert.equal(menuBuild.menuBuildRevision, manifest.sourceRevision);
assert.equal(menuBuild.gamesSourceRevision, manifest.sourceRevision);
assert.equal(menuBuild.buildVersion, manifest.buildVersion);
assert.equal(menuBuild.releaseTag, manifest.releaseTag);
assert.ok(Boolean(menuBuild.menuBuildDate), "player menu build date is missing");
const displayBuild = JSON.parse(await readFile(path.join(root, manifest.playerDisplay!.buildManifest!), "utf8")) as {
  schema?: string;
  displayBuildRevision?: string;
  displayBuildDate?: string;
  gamesSourceRevision?: string;
  buildVersion?: string;
  releaseTag?: string | null;
};
assert.equal(displayBuild.schema, "motion-levels-player-display-build-v1");
assert.equal(displayBuild.displayBuildRevision, manifest.sourceRevision);
assert.equal(displayBuild.gamesSourceRevision, manifest.sourceRevision);
assert.equal(displayBuild.buildVersion, manifest.buildVersion);
assert.equal(displayBuild.releaseTag, manifest.releaseTag);
assert.ok(Boolean(displayBuild.displayBuildDate), "player display build date is missing");
const compiledMenuEntries = files.filter((file) => /^menu\/assets\/.*\.js$/u.test(file.path));
assert.ok(compiledMenuEntries.length > 0, "player menu has no compiled JavaScript");
assert.ok(
  (await Promise.all(compiledMenuEntries.map(async (file) => (
    await readFile(path.join(root, file.path))
  ).includes(Buffer.from(manifest.sourceRevision!))))).some(Boolean),
  "player menu JavaScript does not contain its declared games source revision"
);
assert.ok(
  (await Promise.all(compiledMenuEntries.map(async (file) => (
    await readFile(path.join(root, file.path))
  ).includes(Buffer.from(manifest.buildVersion!))))).some(Boolean),
  "player menu JavaScript does not contain its declared build version"
);
const compiledDisplayShellEntries = files.filter((file) => /^display\/assets\/.*\.js$/u.test(file.path));
assert.ok(compiledDisplayShellEntries.length > 0, "player display shell has no compiled JavaScript");
assert.ok(
  (await Promise.all(compiledDisplayShellEntries.map(async (file) => (
    await readFile(path.join(root, file.path))
  ).includes(Buffer.from(manifest.sourceRevision!))))).some(Boolean),
  "player display shell JavaScript does not contain its declared games source revision"
);
assert.ok(
  (await Promise.all(compiledDisplayShellEntries.map(async (file) => (
    await readFile(path.join(root, file.path))
  ).includes(Buffer.from(manifest.buildVersion!))))).some(Boolean),
  "player display shell JavaScript does not contain its declared build version"
);
for (const [label, entry] of [
  ["venue runtime", manifest.venueRuntime!.entry!],
  ["player display", manifest.playerDisplay!.entry!]
] as const) {
  const compiled = await readFile(path.join(root, entry));
  assert.ok(compiled.includes(Buffer.from(manifest.sourceRevision!)), `${label} does not contain its source revision`);
}
const compiledPlayerDisplayStyles = await readFile(path.join(root, manifest.playerDisplay!.styleEntry!));
const compiledPlayerDisplay = await readFile(path.join(root, manifest.playerDisplay!.entry!));
assert.ok(
  compiledPlayerDisplayStyles.includes(Buffer.from("data:image/png;base64,")),
  "player display stylesheet does not embed the Motion Levels logo"
);
assert.ok(
  !compiledPlayerDisplayStyles.includes(Buffer.from("./assets/motion-levels-icon.png")),
  "player display stylesheet contains an unresolved Motion Levels logo reference"
);
assert.ok(
  compiledPlayerDisplay.includes(Buffer.from("motion-levels-games-display-styles")),
  "player display JavaScript is missing the legacy embedded-style bridge"
);
assert.ok(
  compiledPlayerDisplay.includes(Buffer.from("data:image/png;base64,")),
  "player display JavaScript does not embed compatibility styles and their logo"
);
for (const selector of [
  ".animation-display",
  ".equilibrio-display",
  ".estela-display",
  ".guardianes-display",
  ".pulso-display",
  ".suelo-seguro-display",
  ".tetris-display",
  ".tira-soga-display"
]) {
  assert.ok(
    compiledPlayerDisplayStyles.includes(Buffer.from(selector)),
    `player display stylesheet is missing game-owned styles for ${selector}`
  );
  assert.ok(
    compiledPlayerDisplay.includes(Buffer.from(selector)),
    `player display JavaScript compatibility styles are missing ${selector}`
  );
}

type MediaAssetMetadata = {
  file?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  bytes?: number;
  sha256?: string;
};

const catalog = JSON.parse(await readFile(path.join(root, manifest.catalog!), "utf8")) as Array<{
  id?: string;
  media?: Partial<Record<GameMediaAssetKind, string>>;
}>;
assert.deepEqual(catalog.map((game) => game.id), gameCatalog.map((game) => game.id));
const productionGameIds = gameCatalog.filter((game) => game.availability.production).map((game) => game.id);
assert.deepEqual(manifest.venueRuntime?.games, productionGameIds);
for (const game of gameCatalog) {
  const catalogEntry = catalog.find((entry) => entry.id === game.id);
  const expectedMedia = gameMediaReferences(game.id);
  assert.deepEqual(catalogEntry?.media, expectedMedia, `${game.id} catalog media does not match the SDK contract`);
  const metadataPath = gameMediaMetadataReference(game.id);
  assert.ok(files.some((file) => file.path === metadataPath), `${game.id} metadata is missing`);
  const metadata = JSON.parse(await readFile(path.join(root, metadataPath), "utf8")) as {
    schema?: string;
    game?: { id?: string; label?: string };
    scenario?: unknown;
    configuration?: { difficulty?: string; options?: unknown; playerCount?: number; seed?: number };
    media?: Partial<Record<GameMediaAssetKind, string>>;
    assets?: Partial<Record<GameMediaAssetKind, MediaAssetMetadata>>;
  };
  const expectedConfiguration = normalizeGameConfig({
    difficulty: game.preview.difficulty,
    options: game.preview.options,
    playerCount: game.preview.playerCount,
    seed: game.preview.seed
  }, game);
  assert.equal(metadata.schema, gameMediaSchema);
  assert.deepEqual(metadata.game, { id: game.id, label: game.label });
  assert.deepEqual(metadata.scenario, game.preview);
  assert.deepEqual(metadata.configuration, {
    difficulty: expectedConfiguration.difficulty,
    options: expectedConfiguration.options,
    playerCount: expectedConfiguration.playerCount,
    seed: expectedConfiguration.seed
  });
  assert.deepEqual(metadata.media, expectedMedia);
  assert.deepEqual(Object.keys(metadata.assets ?? {}).sort(), Object.keys(gameMediaAssetSpecs).sort());
  for (const kind of Object.keys(gameMediaAssetSpecs) as GameMediaAssetKind[]) {
    await verifyMediaAsset(game.id, kind, expectedMedia[kind], metadata.assets?.[kind]);
  }
}

const animationCatalog = JSON.parse(await readFile(path.join(root, manifest.animations!), "utf8")) as {
  schema?: string;
  recipe?: unknown;
  animations?: Array<{ id?: string; animated?: boolean; media?: Record<string, string> }>;
};
assert.equal(animationCatalog.schema, animationMediaSchema);
assert.deepEqual(animationCatalog.recipe, animationPreviewRecipe);
assert.deepEqual(animationCatalog.animations?.map((animation) => animation.id), animationLibrary.map((animation) => animation.id));
for (const animation of animationLibrary) {
  const catalogEntry: { id?: string; animated?: boolean; media?: Record<string, string> } | undefined = animationCatalog.animations?.find((entry) => entry.id === animation.id);
  const expectedMedia = animationMediaReferences(animation.id);
  assert.equal(catalogEntry?.animated, animation.animated);
  assert.deepEqual(catalogEntry?.media, expectedMedia);
  for (const mediaPath of Object.values(expectedMedia)) {
    assert.ok(files.some((file) => file.path === mediaPath), `${animation.id} media is missing: ${mediaPath}`);
  }
  const metadataPath = animationMediaMetadataReference(animation.id);
  assert.ok(files.some((file) => file.path === metadataPath), `${animation.id} metadata is missing`);
  const metadata = JSON.parse(await readFile(path.join(root, metadataPath), "utf8")) as {
    schema?: string;
    animation?: { id?: string; animated?: boolean };
    recipe?: unknown;
    media?: Record<string, string>;
    assets?: Record<string, MediaAssetMetadata>;
  };
  assert.equal(metadata.schema, animationMediaSchema);
  assert.equal(metadata.animation?.id, animation.id);
  assert.equal(metadata.animation?.animated, animation.animated);
  assert.deepEqual(metadata.recipe, animationPreviewRecipe);
  assert.deepEqual(metadata.media, expectedMedia);
  assert.deepEqual(Object.keys(metadata.assets ?? {}).sort(), ["animation", "thumbnail", "thumbnailSmall"]);
  for (const kind of ["thumbnailSmall", "thumbnail", "animation"] as const) {
    await verifyMediaAsset(animation.id, kind, expectedMedia[kind], metadata.assets?.[kind], kind === "animation" ? animation.animated : undefined);
  }
}
assert.deepEqual(files, manifest.files);
assert.equal(bundleContentDigest(files), manifest.artifactDigest);
console.log(`Verified ${files.length} bundle files at ${manifest.artifactDigest}`);

async function verifyMediaAsset(
  ownerId: string,
  kind: GameMediaAssetKind,
  reference: string,
  metadata: MediaAssetMetadata | undefined,
  expectedAnimated?: boolean
): Promise<void> {
  const spec = gameMediaAssetSpecs[kind];
  assert.ok(files.some((file) => file.path === reference), `${ownerId} media is missing: ${reference}`);
  assert.equal(metadata?.file, path.basename(reference), `${ownerId} ${kind} filename does not match its reference`);
  assert.equal(metadata?.width, spec.width, `${ownerId} ${kind} metadata width is invalid`);
  assert.equal(metadata?.height, spec.height, `${ownerId} ${kind} metadata height is invalid`);
  assert.equal(metadata?.mimeType, spec.mimeType, `${ownerId} ${kind} metadata MIME type is invalid`);
  const contents = await readFile(path.join(root, reference));
  assert.equal(metadata?.bytes, contents.length, `${ownerId} ${kind} byte count is stale`);
  assert.equal(
    metadata?.sha256,
    createHash("sha256").update(contents).digest("hex"),
    `${ownerId} ${kind} digest is stale`
  );
  const webp = inspectWebP(contents);
  assert.deepEqual([webp.width, webp.height], [spec.width, spec.height], `${ownerId} ${kind} dimensions are invalid`);
  if (expectedAnimated ?? spec.animated) {
    assert.ok(webp.chunks.includes("ANIM"), `${ownerId} ${kind} is not an animated WebP`);
    assert.ok(webp.chunks.filter((chunk) => chunk === "ANMF").length > 1, `${ownerId} ${kind} needs more than one frame`);
  } else {
    assert.equal(webp.chunks.includes("ANIM"), false, `${ownerId} ${kind} must be a still WebP`);
  }
}

function inspectWebP(buffer: Buffer): { width: number; height: number; chunks: string[] } {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF", "media is not a RIFF file");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP", "media is not a WebP file");
  const chunks: string[] = [];
  let width = 0;
  let height = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    assert.ok(payload + size <= buffer.length, `truncated WebP ${chunk} chunk`);
    chunks.push(chunk);
    if (chunk === "VP8X" && size >= 10) {
      width = 1 + buffer.readUIntLE(payload + 4, 3);
      height = 1 + buffer.readUIntLE(payload + 7, 3);
    } else if (chunk === "VP8 " && size >= 10 && width === 0) {
      width = buffer.readUInt16LE(payload + 6) & 0x3fff;
      height = buffer.readUInt16LE(payload + 8) & 0x3fff;
    } else if (chunk === "VP8L" && size >= 5 && width === 0) {
      const bits = buffer.readUInt32LE(payload + 1);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
    offset = payload + size + (size % 2);
  }
  assert.ok(width > 0 && height > 0, "WebP dimensions are missing");
  return { width, height, chunks };
}
