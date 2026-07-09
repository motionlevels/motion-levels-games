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
      min?: unknown;
      max?: unknown;
    };
    start?: {
      mode?: unknown;
      countdownMillis?: unknown;
      releaseGraceMillis?: unknown;
    };
    config?: {
      difficulty?: {
        default?: unknown;
        options?: unknown;
      };
      vars?: unknown;
    };
    display?: {
      entry?: string;
    };
    defaultDurationMillis?: unknown;
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
      if (!isFiniteNumber(manifest.defaultDurationMillis) || manifest.defaultDurationMillis < 0) {
        problems.push(`${gameId}: manifest.defaultDurationMillis must be a non-negative finite number`);
      }
      if (manifest.players?.allowAny !== undefined && typeof manifest.players.allowAny !== "boolean") {
        problems.push(`${gameId}: manifest.players.allowAny must be a boolean when present`);
      }
      if (!isInteger(manifest.players?.min) || Number(manifest.players?.min) < 1) {
        problems.push(`${gameId}: manifest.players.min must be an integer of at least 1`);
      }
      if (!isInteger(manifest.players?.max) || Number(manifest.players?.max) < Number(manifest.players?.min)) {
        problems.push(`${gameId}: manifest.players.max must be an integer greater than or equal to min`);
      }
      if (manifest.start?.mode !== "player-ready" && manifest.start?.mode !== "immediate") {
        problems.push(`${gameId}: manifest.start.mode must explicitly be player-ready or immediate`);
      }
      if (manifest.start?.mode === "immediate" &&
        (manifest.start.countdownMillis !== undefined || manifest.start.releaseGraceMillis !== undefined)) {
        problems.push(`${gameId}: immediate start must not declare countdown or release grace`);
      }
      if (manifest.start?.mode === "player-ready") {
        for (const field of ["countdownMillis", "releaseGraceMillis"] as const) {
          const value = manifest.start[field];
          if (value !== undefined && (!isFiniteNumber(value) || value <= 0)) {
            problems.push(`${gameId}: manifest.start.${field} must be a positive finite number when present`);
          }
        }
      }
      if (manifest.display?.entry !== "./display") {
        problems.push(`${gameId}: manifest.display.entry must be ./display`);
      }
      if (manifest.config?.difficulty?.options !== undefined && !isStringArray(manifest.config.difficulty.options)) {
        problems.push(`${gameId}: manifest.config.difficulty.options must be a string array`);
      }
      if (isStringArray(manifest.config?.difficulty?.options)) {
        const difficultyOptions = manifest.config.difficulty.options;
        if (difficultyOptions.length === 0 || difficultyOptions.some((option) => option.trim() === "")) {
          problems.push(`${gameId}: manifest.config.difficulty.options must contain non-empty values`);
        }
        if (new Set(difficultyOptions).size !== difficultyOptions.length) {
          problems.push(`${gameId}: manifest.config.difficulty.options must not contain duplicates`);
        }
        const defaultDifficulty = manifest.config.difficulty.default;
        if (defaultDifficulty !== undefined && !difficultyOptions.includes(String(defaultDifficulty))) {
          problems.push(`${gameId}: manifest.config.difficulty.default must be included in difficulty.options`);
        }
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
            if (!("default" in record)) {
              problems.push(`${gameId}: manifest.config.vars[${index}].default is required`);
            }

            if (record.type === "int" || record.type === "float") {
              validateNumericConfigVar(gameId, index, record, problems);
            } else if (record.type === "bool") {
              if (typeof record.default !== "boolean") {
                problems.push(`${gameId}: manifest.config.vars[${index}].default must be a boolean`);
              }
              validateAbsentFields(gameId, index, record, ["min", "max", "step", "options"], problems);
            } else if (record.type === "enum") {
              validateEnumConfigVar(gameId, index, record, problems);
              validateAbsentFields(gameId, index, record, ["min", "max", "step"], problems);
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

function validateNumericConfigVar(
  gameId: string,
  index: number,
  configVar: Record<string, unknown>,
  problems: string[]
): void {
  const prefix = `${gameId}: manifest.config.vars[${index}]`;
  if (!isFiniteNumber(configVar.default)) {
    problems.push(`${prefix}.default must be a finite number`);
    return;
  }
  validateAbsentFields(gameId, index, configVar, ["options"], problems);

  for (const field of ["min", "max", "step"] as const) {
    if (configVar[field] !== undefined && !isFiniteNumber(configVar[field])) {
      problems.push(`${prefix}.${field} must be a finite number when present`);
    }
  }
  if (isFiniteNumber(configVar.min) && isFiniteNumber(configVar.max) && configVar.min > configVar.max) {
    problems.push(`${prefix}.min must not exceed max`);
  }
  if (isFiniteNumber(configVar.min) && configVar.default < configVar.min) {
    problems.push(`${prefix}.default must not be below min`);
  }
  if (isFiniteNumber(configVar.max) && configVar.default > configVar.max) {
    problems.push(`${prefix}.default must not exceed max`);
  }
  if (isFiniteNumber(configVar.step) && configVar.step <= 0) {
    problems.push(`${prefix}.step must be greater than zero`);
  }
  if (configVar.type === "int") {
    for (const field of ["default", "min", "max", "step"] as const) {
      if (isFiniteNumber(configVar[field]) && !Number.isInteger(configVar[field])) {
        problems.push(`${prefix}.${field} must be an integer for int vars`);
      }
    }
  }
}

function validateEnumConfigVar(
  gameId: string,
  index: number,
  configVar: Record<string, unknown>,
  problems: string[]
): void {
  const prefix = `${gameId}: manifest.config.vars[${index}]`;
  if (!Array.isArray(configVar.options) || configVar.options.length === 0) {
    problems.push(`${prefix}.options must be a non-empty array for enum vars`);
    return;
  }

  const values = configVar.options.map((option) =>
    option && typeof option === "object" && !Array.isArray(option)
      ? String((option as Record<string, unknown>).value ?? "").trim()
      : ""
  );
  if (values.some((value) => value === "")) {
    problems.push(`${prefix}.options must contain non-empty values`);
  }
  if (new Set(values).size !== values.length) {
    problems.push(`${prefix}.options must not contain duplicate values`);
  }
  if (typeof configVar.default !== "string" || !values.includes(configVar.default)) {
    problems.push(`${prefix}.default must match an enum option value`);
  }
}

function validateAbsentFields(
  gameId: string,
  index: number,
  configVar: Record<string, unknown>,
  fields: string[],
  problems: string[]
): void {
  for (const field of fields) {
    if (configVar[field] !== undefined) {
      problems.push(`${gameId}: manifest.config.vars[${index}].${field} is not valid for ${String(configVar.type)} vars`);
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
