import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(path.join(tmpdir(), "motion-levels-game-scaffold-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const result = spawnSync(npmCommand, [
  "run",
  "create:game",
  "--",
  "ci-smoke-game",
  "CI Smoke Game",
  "--root",
  root
], {
  cwd: process.cwd(),
  encoding: "utf8"
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const gameRoot = path.join(root, "games/ci-smoke-game");
const expectedFiles = [
  "README.md",
  "package.json",
  "src/display.tsx",
  "src/fixtures.ts",
  "src/game.ts",
  "src/index.ts",
  "src/manifest.ts",
  "test/ci-smoke-game.test.ts",
  "tsconfig.json"
];

for (const file of expectedFiles) {
  await stat(path.join(gameRoot, file));
}

const packageJson = JSON.parse(await readFile(path.join(gameRoot, "package.json"), "utf8")) as { name?: string };
assert.equal(packageJson.name, "@motion-levels-games/ci-smoke-game");

const manifestModule = await import(pathToFileURL(path.join(gameRoot, "src/manifest.ts")).href) as {
  manifest?: {
    id?: string;
    label?: string;
  };
};
assert.equal(manifestModule.manifest?.id, "ci-smoke-game");
assert.equal(manifestModule.manifest?.label, "CI Smoke Game");

const readme = await readFile(path.join(gameRoot, "README.md"), "utf8");
assert.match(readme, /ci-smoke-game/);
assert.match(readme, /Required player display review/);
assert.match(readme, /native 1920x1080 player display/);

console.log(`Scaffold smoke test created ${gameRoot}`);
