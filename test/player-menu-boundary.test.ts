import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const menuRoot = path.join(repoRoot, "apps/player-menu");

test("player experience apps are source-independent from venue and platform repositories", async () => {
  const appRoots = [menuRoot, path.join(repoRoot, "apps/player-display")];
  for (const appRoot of appRoots) for (const file of await sourceFiles(path.join(appRoot, "src"))) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /@motion-levels\/(?:core|design-tokens|floor-view)/u, path.relative(repoRoot, file));
    assert.doesNotMatch(source, /motion-levels-(?:venue|platform)/u, path.relative(repoRoot, file));
  }
});

test("production bundle declares the static menu and adapter protocol", async () => {
  const source = await readFile(path.join(repoRoot, "scripts/build-bundle.ts"), "utf8");
  assert.match(source, /apps\/player-menu\/dist/u);
  assert.match(
    source,
    /playerMenu:\s*\{[\s\S]*?entry: "menu\/index\.html",[\s\S]*?buildManifest: "menu\/build\.json",[\s\S]*?adapterProtocolVersion: playerMenuAdapterProtocolVersion[\s\S]*?\}/u,
  );
  assert.match(source, /MOTION_LEVELS_GAMES_SOURCE_REVISION: sourceRevision/u);
  assert.match(source, /MOTION_LEVELS_GAMES_MEDIA_DIR \|\| path\.join\(repoRoot, "assets\/media"\)/u);
  assert.doesNotMatch(source, /defaultDistMedia/u);
  assert.match(source, /apps\/player-menu\/dist\/build\.json/u);
  assert.match(source, /schema: "motion-levels-games-bundle-v2"/u);
  assert.match(source, /entry: "venue\/runtime\.mjs"/u);
  assert.match(source, /apiProtocolVersion: venueApiProtocolVersion/u);
  assert.match(source, /controllerProtocolVersion/u);
});

test("production bundle declares the complete player display shell and renderer", async () => {
  const source = await readFile(path.join(repoRoot, "scripts/build-bundle.ts"), "utf8");
  assert.match(source, /apps\/player-display\/dist/u);
  assert.match(source, /entry: "display\/display\.js"/u);
  assert.match(source, /shellEntry: "display\/index\.html"/u);
});

test("offline menu catalog carries the exact bundled games revision", async () => {
  const vite = await readFile(path.join(menuRoot, "vite.config.ts"), "utf8");
  const playgroundVite = await readFile(path.join(repoRoot, "apps/playground/vite.config.ts"), "utf8");
  const catalog = await readFile(path.join(menuRoot, "src/localCatalog.ts"), "utf8");
  const bundleMedia = await readFile(path.join(menuRoot, "src/bundleMedia.ts"), "utf8");
  assert.match(vite, /git rev-parse HEAD/u);
  assert.match(vite, /MOTION_LEVELS_GAMES_SOURCE_REVISION/u);
  assert.match(playgroundVite, /MOTION_LEVELS_GAMES_SOURCE_REVISION/u);
  assert.match(bundleMedia, /declare const MOTION_LEVELS_GAMES_SOURCE_REVISION: string/u);
  assert.match(bundleMedia, /mediaURL\.searchParams\.set\("revision", revision\)/u);
  assert.match(catalog, /const sourceRevision = bundledGamesSourceRevision\(\)/u);
  assert.match(catalog, /gameBundleMediaSources\(manifest\.id, sourceRevision, menuLocation\)/u);
  assert.match(catalog, /source_revision: sourceRevision/u);
});

test("the menu consumes only the canonical revisioned player state", async () => {
  const api = await readFile(path.join(menuRoot, "src/api.ts"), "utf8");
  const app = await readFile(path.join(menuRoot, "src/App.tsx"), "utf8");
  const contracts = await readFile(path.join(menuRoot, "src/contracts.ts"), "utf8");
  assert.match(api, /\/api\/player-state/);
  assert.match(api, /\/api\/player-state\/events/);
  assert.match(api, /commandId/);
  assert.match(app, /PlayerExperienceStateGate/);
  assert.match(app, /status \? playerExperienceView\(status\)\.screen : fallbackScreenMode/);
  assert.doesNotMatch(app, /(?:launchedGameID|stoppedLevelGameID|introUntil|countdownUntil)/u);
  assert.match(
    app,
    /type MenuMirrorSnapshot = \{\s*menu: MenuState;\s*screen\?: "browse" \| "game" \| "welcome";\s*view\?: \{/u
  );
  assert.doesNotMatch(contracts, /export type EngineStatus = \{/u);
});

test("the menu reads the runtime-owned authoritative floor stream", async () => {
  const source = await readFile(path.join(menuRoot, "src/LiveFloorView.tsx"), "utf8");
  assert.match(source, /new EventSource\(liveFloorEventsURL\(\)\)/u);
  assert.match(source, /\/api\/live-floor\/events/u);
  assert.match(source, /addEventListener\("live-floor"/u);
  assert.doesNotMatch(source, /controller\/ws|new WebSocket|\.send\(/u);
});

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) files.push(file);
  }
  return files;
}
