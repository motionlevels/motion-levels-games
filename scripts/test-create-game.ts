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
    slug?: string;
    aliases?: readonly string[];
    label?: string;
    players?: {
      allowAny?: boolean;
    };
  };
};
assert.match(manifestModule.manifest?.id ?? "", /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
assert.equal(manifestModule.manifest?.slug, "ci-smoke-game");
assert.deepEqual(manifestModule.manifest?.aliases, ["ci-smoke-game"]);
assert.equal(manifestModule.manifest?.label, "CI Smoke Game");
assert.equal(manifestModule.manifest?.players?.allowAny, true);

const readme = await readFile(path.join(gameRoot, "README.md"), "utf8");
const gameSource = await readFile(path.join(gameRoot, "src/game.ts"), "utf8");
assert.match(readme, /ci-smoke-game/);
assert.match(readme, /generated UUID/);
assert.match(readme, /Required player display review/);
assert.match(readme, /native 1920x1080 player display/);
assert.match(readme, /Required winning animations/);
assert.match(readme, /distinct game-win animation/);
assert.match(readme, /Lives, when applicable/);
assert.match(readme, /render `LivesMeter`/);
assert.match(readme, /Player count policy/);
assert.match(readme, /players\.allowAny: true/);
assert.match(readme, /packages\/runtime\/src\/gameplayRegistry\.ts/);
assert.match(readme, /production runtime/);
assert.match(readme, /Gameplay tuning variables/);
assert.match(readme, /readGameConfigOption/);
assert.match(readme, /playerFacing: false/);
assert.match(readme, /Design for venue viewing distance/);
assert.match(readme, /large empty metric cards/);
assert.match(readme, /@motion-levels-games\/game-sdk\/effects/);
assert.match(gameSource, /import \{ paintDiamondRing \} from "@motion-levels-games\/game-sdk\/effects"/);

console.log(`Scaffold smoke test created ${gameRoot}`);
