import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const sharedPackages = new Set([
  "@motion-levels-games/display-kit",
  "@motion-levels-games/game-sdk"
]);

test("workspace source imports respect package ownership", async () => {
  const sourceRoots = [
    { directory: "packages/game-sdk/src", allowed: new Set<string>() },
    { directory: "packages/display-kit/src", allowed: new Set(["@motion-levels-games/game-sdk"]) },
    { directory: "apps/playground/src", allowed: sharedPackages },
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

async function gameSourceRoots() {
  const gamesDirectory = new URL("games/", repositoryRoot);
  const entries = await readdir(gamesDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: `games/${entry.name}/src`,
      allowed: sharedPackages
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
