import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const menuRoot = path.join(repoRoot, "apps/player-menu");

test("player menu is source-independent from venue and platform repositories", async () => {
  for (const file of await sourceFiles(path.join(menuRoot, "src"))) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /@motion-levels\/(?:core|design-tokens|floor-view)/u, path.relative(repoRoot, file));
    assert.doesNotMatch(source, /motion-levels-(?:venue|platform)/u, path.relative(repoRoot, file));
  }
});

test("production bundle declares the static menu and adapter protocol", async () => {
  const source = await readFile(path.join(repoRoot, "scripts/build-bundle.ts"), "utf8");
  assert.match(source, /apps\/player-menu\/dist/u);
  assert.match(source, /playerMenu:\s*\{ entry: "menu\/index\.html", adapterProtocolVersion: playerMenuAdapterProtocolVersion \}/u);
});

test("the menu consumes only the canonical revisioned player state", async () => {
  const api = await readFile(path.join(menuRoot, "src/api.ts"), "utf8");
  const app = await readFile(path.join(menuRoot, "src/App.tsx"), "utf8");
  const contracts = await readFile(path.join(menuRoot, "src/contracts.ts"), "utf8");
  assert.match(api, /\/api\/player-state/);
  assert.match(api, /\/api\/player-state\/events/);
  assert.match(api, /commandId/);
  assert.match(app, /acceptsPlayerExperienceState/);
  assert.match(app, /status \? playerExperienceView\(status\)\.screen : fallbackScreenMode/);
  assert.doesNotMatch(app, /(?:launchedGameID|stoppedLevelGameID|introUntil|countdownUntil)/u);
  assert.match(app, /type MenuMirrorSnapshot = \{\s*menu: MenuState;\s*\}/u);
  assert.doesNotMatch(contracts, /export type EngineStatus = \{/u);
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
