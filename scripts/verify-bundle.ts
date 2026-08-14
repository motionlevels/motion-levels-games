import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  animationLibrary,
  animationMediaReferences,
  animationMediaSchema
} from "../packages/animation-runtime/src/index.ts";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA
} from "../packages/session-history/src/index.ts";
import { bundleContentDigest, bundleFiles } from "./bundle-files.ts";

const root = path.resolve(process.env.MOTION_LEVELS_GAMES_BUNDLE_DIR || path.join(process.cwd(), "dist/bundle"));
const manifest = JSON.parse(await readFile(path.join(root, "bundle.json"), "utf8")) as {
  schema?: string;
  contractVersion?: number;
  venueRuntime?: { entry?: string; apiProtocolVersion?: number; controllerProtocolVersion?: number; games?: string[] };
  playerMenu?: { entry?: string; adapterProtocolVersion?: number };
  playerExperience?: { contractVersion?: number; schema?: string };
  sessionHistory?: { contractVersion?: number; schemaId?: string; schema?: string };
  playerDisplay?: { entry?: string; shellEntry?: string; games?: string[] };
  playground?: { entry?: string; basePath?: string };
  animations?: string;
  sourceRevision?: string;
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
assert.equal(manifest.playerDisplay?.shellEntry, "display/index.html");
assert.deepEqual(manifest.playerDisplay?.games, manifest.venueRuntime?.games);
assert.equal(manifest.playerMenu?.entry, "menu/index.html");
assert.equal(manifest.playerMenu?.adapterProtocolVersion, 2);
assert.equal(manifest.playerExperience?.contractVersion, 1);
assert.equal(manifest.playerExperience?.schema, "player-experience-state.schema.json");
assert.equal(manifest.sessionHistory?.contractVersion, SESSION_HISTORY_CONTRACT_VERSION);
assert.equal(manifest.sessionHistory?.schemaId, SESSION_HISTORY_SCHEMA);
assert.equal(manifest.sessionHistory?.schema, "session-history-v1.schema.json");
assert.equal(manifest.playground?.entry, "playground/index.html");
assert.equal(manifest.playground?.basePath, "/games/play/");
assert.equal(manifest.animations, "animations.json");
assert.equal(manifest.sdkFps, 50);
assert.match(String(manifest.sourceRevision), /^[0-9a-f]{40}$/u);
assert.equal("runtime" in manifest, false);
const files = await bundleFiles(root);
assert.ok(files.some((file) => file.path === manifest.venueRuntime?.entry), "venue runtime entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerDisplay?.entry), "player display entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerDisplay?.shellEntry), "player display shell is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerMenu?.entry), "player menu entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playground?.entry), "playground entry is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.animations), "animation catalog is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.playerExperience?.schema), "player experience schema is missing from bundle files");
assert.ok(files.some((file) => file.path === manifest.sessionHistory?.schema), "session history schema is missing from bundle files");

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

const animationCatalog = JSON.parse(await readFile(path.join(root, manifest.animations!), "utf8")) as {
  schema?: string;
  animations?: Array<{ id?: string; media?: Record<string, string> }>;
};
assert.equal(animationCatalog.schema, animationMediaSchema);
assert.deepEqual(animationCatalog.animations?.map((animation) => animation.id), animationLibrary.map((animation) => animation.id));
for (const animation of animationLibrary) {
  const catalogEntry: { id?: string; media?: Record<string, string> } | undefined = animationCatalog.animations?.find((entry) => entry.id === animation.id);
  const expectedMedia = animationMediaReferences(animation.id);
  assert.deepEqual(catalogEntry?.media, expectedMedia);
  for (const mediaPath of Object.values(expectedMedia)) {
    assert.ok(files.some((file) => file.path === mediaPath), `${animation.id} media is missing: ${mediaPath}`);
  }
  const metadataPath = `media/animations/${animation.id}/metadata.json`;
  const metadata = JSON.parse(await readFile(path.join(root, metadataPath), "utf8")) as {
    animation?: { id?: string };
    assets?: Record<string, { width?: number; height?: number; mimeType?: string; bytes?: number }>;
  };
  assert.equal(metadata.animation?.id, animation.id);
  assert.deepEqual(
    Object.fromEntries(Object.entries(metadata.assets ?? {}).map(([kind, asset]) => [kind, [asset.width, asset.height]])),
    { thumbnailSmall: [256, 128], thumbnail: [1024, 512], animation: [512, 256] }
  );
  assert.ok(Object.values(metadata.assets ?? {}).every((asset) => asset.mimeType === "image/webp" && Number(asset.bytes) > 0));
  const animatedWebP = await readFile(path.join(root, expectedMedia.animation));
  assert.ok(animatedWebP.includes(Buffer.from("ANIM")), `${animation.id} preview is not an animated WebP`);
  assert.ok(countChunks(animatedWebP, "ANMF") > 1, `${animation.id} preview needs more than one frame`);
}
assert.deepEqual(files, manifest.files);
assert.equal(bundleContentDigest(files), manifest.artifactDigest);
console.log(`Verified ${files.length} bundle files at ${manifest.artifactDigest}`);

function countChunks(buffer: Buffer, chunk: string): number {
  const marker = Buffer.from(chunk);
  let count = 0;
  let offset = 0;
  while ((offset = buffer.indexOf(marker, offset)) >= 0) {
    count += 1;
    offset += marker.length;
  }
  return count;
}
