import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const gamePackages = new Set([
  "@motion-levels-games/agent-analytics",
  "@motion-levels-games/agent-runtime",
  "@motion-levels-games/animation-runtime",
  "@motion-levels-games/display-kit",
  "@motion-levels-games/game-sdk",
  "@motion-levels-games/player-experience",
  "@motion-levels-games/published-level-runtime",
  "@motion-levels-games/replay-runtime"
]);
const playgroundPackages = new Set([
  ...gamePackages,
  "@motion-levels-games/jugar-3d"
]);

test("workspace source imports respect package ownership", async () => {
  const runtimePackages = new Set([
    ...gamePackages,
    ...await gamePackageNames()
  ]);
  const sourceRoots = [
    { directory: "packages/game-sdk/src", allowed: new Set<string>() },
    { directory: "packages/display-kit/src", allowed: new Set(["@motion-levels-games/game-sdk"]) },
    { directory: "packages/agent-runtime/src", allowed: new Set(["@motion-levels-games/game-sdk"]) },
    { directory: "packages/animation-runtime/src", allowed: new Set(["@motion-levels-games/game-sdk"]) },
    { directory: "packages/agent-analytics/src", allowed: new Set(["@motion-levels-games/replay-runtime"]) },
    { directory: "packages/replay-runtime/src", allowed: new Set(["@motion-levels-games/game-sdk"]) },
    { directory: "packages/player-experience/src", allowed: new Set<string>() },
    { directory: "packages/session-history/src", allowed: new Set<string>() },
    {
      directory: "packages/published-level-runtime/src",
      allowed: new Set([
        "@motion-levels-games/display-kit",
        "@motion-levels-games/game-sdk"
      ])
    },
    { directory: "packages/character-runtime/src", allowed: new Set<string>() },
    { directory: "packages/runtime/src", allowed: runtimePackages },
    {
      directory: "packages/jugar-3d/src",
      allowed: new Set([
        "@motion-levels-games/character-runtime",
        "@motion-levels-games/display-kit",
        "@motion-levels-games/game-sdk",
        "@motion-levels-games/replay-runtime"
      ])
    },
    { directory: "apps/playground/src", allowed: playgroundPackages },
    {
      directory: "apps/player-display/src",
      allowed: new Set(["@motion-levels-games/player-experience"])
    },
    {
      directory: "apps/venue-runtime/src",
      allowed: new Set([
        "@motion-levels-games/game-sdk",
        "@motion-levels-games/player-experience",
        "@motion-levels-games/runtime",
        "@motion-levels-games/session-history"
      ])
    },
    ...await gameSourceRoots()
  ];

  for (const { directory, allowed } of sourceRoots) {
    for (const file of await sourceFiles(directory)) {
      const source = await readFile(new URL(file, repositoryRoot), "utf8");
      for (const dependency of internalDependencies(source)) {
        assert.ok(
          allowed.has(dependency),
          `${file} imports ${dependency}, which violates the ${directory} package boundary`
        );
      }
    }
  }
});

async function gamePackageNames(): Promise<string[]> {
  const entries = await readdir(new URL("games/", repositoryRoot), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `@motion-levels-games/${entry.name}`);
}

async function gameSourceRoots() {
  const gamesDirectory = new URL("games/", repositoryRoot);
  const entries = await readdir(gamesDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: `games/${entry.name}/src`,
      allowed: gamePackages
    }));
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const rootPath = fileURLToPath(repositoryRoot);

  async function walk(absoluteDirectory: string): Promise<void> {
    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
      const absolutePath = join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
        files.push(relative(rootPath, absolutePath));
      }
    }
  }

  await walk(fileURLToPath(new URL(`${directory}/`, repositoryRoot)));
  return files;
}

function internalDependencies(source: string): string[] {
  const dependencies = new Set<string>();
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](@motion-levels-games\/[^"'/]+)(?:\/[^"']*)?["']/g;
  const dynamicImportPattern = /import\(\s*["'](@motion-levels-games\/[^"'/]+)(?:\/[^"']*)?["']\s*\)/g;

  for (const pattern of [importPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        dependencies.add(match[1]);
      }
    }
  }

  return [...dependencies];
}
