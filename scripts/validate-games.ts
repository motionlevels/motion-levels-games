import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ManifestModule = {
  manifest?: {
    id?: string;
    label?: string;
    players?: {
      allowAny?: unknown;
    };
    config?: {
      difficulty?: {
        options?: unknown;
      };
      vars?: unknown;
    };
    display?: {
      entry?: string;
    };
  };
};

const repoRoot = process.cwd();
const gamesRoot = path.join(repoRoot, "games");
const requiredFiles = [
  "README.md",
  "package.json",
  "src/display.tsx",
  "src/fixtures.ts",
  "src/game.ts",
  "src/index.ts",
  "src/manifest.ts",
  "test"
];

const gameDirs = (await readdir(gamesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(gameDirs.length > 0, "expected at least one game under games/");

const problems: string[] = [];

for (const gameId of gameDirs) {
  const gameRoot = path.join(gamesRoot, gameId);

  for (const requiredFile of requiredFiles) {
    const requiredPath = path.join(gameRoot, requiredFile);
    try {
      await stat(requiredPath);
    } catch {
      problems.push(`${gameId}: missing ${requiredFile}`);
    }
  }

  try {
    const packageJson = JSON.parse(await readFile(path.join(gameRoot, "package.json"), "utf8")) as { name?: string };
    const expectedPackageName = `@motion-levels-games/${gameId}`;
    if (packageJson.name !== expectedPackageName) {
      problems.push(`${gameId}: package name must be ${expectedPackageName}`);
    }
  } catch (error) {
    problems.push(`${gameId}: could not read package.json (${errorMessage(error)})`);
  }

  try {
    const manifestModule = await import(pathToFileURL(path.join(gameRoot, "src/manifest.ts")).href) as ManifestModule;
    const manifest = manifestModule.manifest;

    if (!manifest) {
      problems.push(`${gameId}: src/manifest.ts must export manifest`);
    } else {
      if (manifest.id !== gameId) {
        problems.push(`${gameId}: manifest.id must exactly match directory name (${gameId})`);
      }
      if (!manifest.label) {
        problems.push(`${gameId}: manifest.label is required`);
      }
      if (manifest.players?.allowAny !== undefined && typeof manifest.players.allowAny !== "boolean") {
        problems.push(`${gameId}: manifest.players.allowAny must be a boolean when present`);
      }
      if (manifest.display?.entry !== "./display") {
        problems.push(`${gameId}: manifest.display.entry must be ./display`);
      }
      if (manifest.config?.difficulty?.options !== undefined && !isStringArray(manifest.config.difficulty.options)) {
        problems.push(`${gameId}: manifest.config.difficulty.options must be a string array`);
      }
      if (manifest.config?.vars !== undefined) {
        if (!Array.isArray(manifest.config.vars)) {
          problems.push(`${gameId}: manifest.config.vars must be an array`);
        } else {
          const seenConfigKeys = new Set<string>();
          for (const [index, configVar] of manifest.config.vars.entries()) {
            if (!configVar || typeof configVar !== "object" || Array.isArray(configVar)) {
              problems.push(`${gameId}: manifest.config.vars[${index}] must be an object`);
              continue;
            }

            const record = configVar as Record<string, unknown>;
            const key = String(record.key || "").trim();
            if (!key) {
              problems.push(`${gameId}: manifest.config.vars[${index}].key is required`);
            } else if (seenConfigKeys.has(key)) {
              problems.push(`${gameId}: manifest.config.vars contains duplicate key ${key}`);
            }
            seenConfigKeys.add(key);

            if (!String(record.label || "").trim()) {
              problems.push(`${gameId}: manifest.config.vars[${index}].label is required`);
            }
            if (!["int", "float", "bool", "enum"].includes(String(record.type))) {
              problems.push(`${gameId}: manifest.config.vars[${index}].type must be int, float, bool, or enum`);
            }
            if (record.type === "enum" && !Array.isArray(record.options)) {
              problems.push(`${gameId}: manifest.config.vars[${index}].options is required for enum vars`);
            }
          }
        }
      }
    }
  } catch (error) {
    problems.push(`${gameId}: could not import src/manifest.ts (${errorMessage(error)})`);
  }

  try {
    const readme = await readFile(path.join(gameRoot, "README.md"), "utf8");
    if (!readme.includes(gameId)) {
      problems.push(`${gameId}: README.md must mention the game id`);
    }
  } catch (error) {
    problems.push(`${gameId}: could not read README.md (${errorMessage(error)})`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `- ${problem}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${gameDirs.length} games: ${gameDirs.join(", ")}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
