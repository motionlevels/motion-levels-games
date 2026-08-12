import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared Stage retains the deployed Jugar camera, lighting, floor, TV and character composition", async () => {
  const stage = await source("../src/scene/Stage.tsx");
  assert.match(stage, /camera=\{\{ fov: 42, near: 0\.1, far: 220, position: \[0, 14, 20\] \}\}/u);
  assert.match(stage, /ambientLight color="#5b7683" intensity=\{0\.6\}/u);
  assert.match(stage, /directionalLight[\s\S]*?color="#cfeaff"[\s\S]*?position=\{\[7, 14, 8\]\}/u);
  assert.match(stage, /shadows=\{\{ enabled: quality !== "mobile-low", type: THREE\.PCFShadowMap \}\}/u);
  assert.doesNotMatch(stage, /PCFSoftShadowMap/u);
  assert.match(stage, /<Arena \/>[\s\S]*?<TileFloor[\s\S]*?<TvDisplay/u);
  assert.match(stage, /<Robot avatar=\{avatar\}/u);
  assert.match(stage, /characterComponent\(characterId\)/u);
});

test("shared floor keeps the canonical 16x32 half-metre Jugar transform", async () => {
  const tileMath = await source("../src/core/tileMath.ts");
  const tileFloor = await source("../src/scene/TileFloor.tsx");
  assert.match(tileMath, /export const TILE_SIZE = 0\.5/u);
  assert.match(tileMath, /FLOOR_WORLD_WIDTH = FLOOR_COLS \* TILE_SIZE/u);
  assert.match(tileMath, /FLOOR_WORLD_DEPTH = FLOOR_ROWS \* TILE_SIZE/u);
  assert.match(tileFloor, /FLOOR_COLS \* FLOOR_ROWS/u);
  assert.match(tileFloor, /instancedMesh/u);
});

test("Vite-facing shared source has no Node process global", async () => {
  const stage = await source("../src/scene/Stage.tsx");
  const hook = await source("../src/core/useGameSession.ts");
  assert.doesNotMatch(stage, /process\.env/u);
  assert.doesNotMatch(hook, /process\.env/u);
  assert.match(stage, /captureFrames/u);
  assert.match(hook, /exposeOnWindow/u);
});

test("shared package carries the visible Sahur licence obligation", async () => {
  const packageManifest = JSON.parse(await source("../package.json")) as { files?: string[] };
  const attribution = await source("../ATTRIBUTIONS.md");
  const catalog = await source("../src/characters/catalog.ts");
  assert.ok(packageManifest.files?.includes("ATTRIBUTIONS.md"));
  assert.match(attribution, /KAG3D/u);
  assert.match(attribution, /Creative Commons Attribution 4\.0/u);
  assert.match(catalog, /author: "KAG3D"/u);
  assert.match(catalog, /license: "CC Attribution"/u);
});

test("the picker exposes ten animated CC0 characters and the stage maps every rig", async () => {
  const catalog = await source("../src/characters/catalog.ts");
  const components = await source("../src/characters/components.ts");
  const riggedCharacter = await source("../src/characters/RiggedCharacter.tsx");
  assert.equal(catalog.match(/quaterniusCharacter\(/gu)?.length, 11);
  for (const id of [
    "adventurer", "casual-hoodie", "mystic", "punk", "spacesuit",
    "star-pilot", "street-scout", "swat", "trailblazer", "worker"
  ]) {
    assert.match(components, new RegExp(`rigged\\("${id}"\\)`, "u"));
  }
  assert.match(catalog, /license: "CC0"/u);
  assert.match(riggedCharacter, /Idle_Neutral/u);
  assert.match(riggedCharacter, /HitRecieve/u);
  assert.match(riggedCharacter, /setActionPhase\(actionRefs\.current\.Death/u);
});

test("the playground serves and packages character GLBs outside its public tree", async () => {
  const vite = await readFile(new URL("../../../apps/playground/vite.config.ts", import.meta.url), "utf8");
  assert.match(vite, /motion-levels-character-models/u);
  assert.match(vite, /server\.middlewares\.use\("\/models"/u);
  assert.match(vite, /path\.join\(modelsOutput, "quaternius"\)/u);
  assert.match(vite, /copyFileSync\(path\.join\(characterAssetsRoot, entry\.name\), destination\)/u);
});

test("shared Stage instrumentation is opt-in and uses renderer totals", async () => {
  const stage = await source("../src/scene/Stage.tsx");
  assert.match(stage, /onDiagnostics\?: \(diagnostics: JugarStageDiagnostics\) => void/u);
  assert.match(stage, /gl\.info\.render\.calls/u);
  assert.match(stage, /gl\.info\.render\.triangles/u);
  assert.match(stage, /gl\.info\.memory\.geometries/u);
  assert.match(stage, /gl\.info\.memory\.textures/u);
  assert.match(stage, /estimateJugarStageMemoryProxy/u);
});

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}
