import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bundleContentDigest, bundleFiles } from "./bundle-files.ts";

const root = path.resolve(process.env.MOTION_LEVELS_GAMES_BUNDLE_DIR || path.join(process.cwd(), "dist/bundle"));
const manifest = JSON.parse(await readFile(path.join(root, "bundle.json"), "utf8")) as {
  schema?: string;
  contractVersion?: number;
  runnerProtocolVersion?: number;
  sourceRevision?: string;
  sdkFps?: number;
  artifactDigest?: string;
  files?: unknown[];
};
assert.equal(manifest.schema, "motion-levels-games-bundle-v1");
assert.equal(manifest.contractVersion, 1);
assert.equal(manifest.runnerProtocolVersion, 1);
assert.equal(manifest.sdkFps, 50);
assert.match(String(manifest.sourceRevision), /^[0-9a-f]{40}$/u);
const files = await bundleFiles(root);
assert.deepEqual(files, manifest.files);
assert.equal(bundleContentDigest(files), manifest.artifactDigest);
console.log(`Verified ${files.length} bundle files at ${manifest.artifactDigest}`);
