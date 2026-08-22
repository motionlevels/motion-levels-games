import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isStableGameId } from "../packages/game-sdk/src/index.ts";
import { gamePackageRegistry } from "../packages/game-catalog/src/gameplayRegistry.ts";

type ManifestModule = {
  manifest?: {
    id?: string;
    slug?: string;
    aliases?: readonly string[];
    label?: string;
    availability?: {
      development?: unknown;
      production?: unknown;
    };
    catalog?: {
      category?: unknown;
      color?: unknown;
      durationLabel?: unknown;
      modeLabel?: unknown;
      audioLabel?: unknown;
      rules?: unknown;
    };
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
    preview?: {
      seed?: unknown;
      playerCount?: unknown;
      actions?: unknown;
      captureStartMillis?: unknown;
      frameCount?: unknown;
      frameIntervalMillis?: unknown;
    };
    defaultDurationMillis?: unknown;
  };
};

type PreviewManifest = NonNullable<NonNullable<ManifestModule["manifest"]>["preview"]>;
type PlayersManifest = NonNullable<NonNullable<ManifestModule["manifest"]>["players"]>;

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

const ALLOWED_GAME_IMPORT_PACKAGES = [
  "@motion-levels-games/game-sdk",
  "@motion-levels-games/display-kit",
  "@motion-levels-games/agent-runtime",
  "@motion-levels-games/replay-runtime",
  "@motion-levels-games/character-runtime",
  "@motion-levels-games/published-level-runtime",
  "@motion-levels-games/animation-runtime",
  "react",
  "react-dom",
  "node:"
];

const gameDirs = (await readdir(gamesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(gameDirs.length > 0, "expected at least one game under games/");

const problems: string[] = [];
const playableGameDirs = (await Promise.all(gameDirs.map(async (gameId) => {
  const packageJson = JSON.parse(await readFile(path.join(gamesRoot, gameId, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>;
  };
  return packageJson.exports?.["./game"] ? gameId : null;
}))).filter((gameId): gameId is string => gameId !== null);
const registeredGameIds = [...gamePackageRegistry.keys()].sort();
if (JSON.stringify(registeredGameIds) !== JSON.stringify(playableGameDirs)) {
  const missing = playableGameDirs.filter((gameId) => !gamePackageRegistry.has(gameId));
  const unexpected = registeredGameIds.filter((gameId) => !playableGameDirs.includes(gameId));
  if (missing.length > 0) problems.push(`production runtime registry is missing: ${missing.join(", ")}`);
  if (unexpected.length > 0) problems.push(`production runtime registry has unknown games: ${unexpected.join(", ")}`);
}

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
      if ((manifest.slug ?? manifest.id) !== gameId) {
        problems.push(`${gameId}: manifest.slug (or legacy id) must exactly match directory name (${gameId})`);
      }
      if (manifest.slug !== undefined && !isStableGameId(String(manifest.id ?? ""))) {
        problems.push(`${gameId}: manifests with a renameable slug must use a UUID or hash as manifest.id`);
      }
      if (manifest.aliases !== undefined && !isStringArray(manifest.aliases)) {
        problems.push(`${gameId}: manifest.aliases must be a string array`);
      }
      if (manifest.slug !== undefined && isStableGameId(String(manifest.id ?? ""))
        && !manifest.aliases?.includes(manifest.slug)) {
        problems.push(`${gameId}: stable-id manifests must retain manifest.slug in manifest.aliases`);
      }
      if (!manifest.label) {
        problems.push(`${gameId}: manifest.label is required`);
      }
      if (typeof manifest.availability?.development !== "boolean" || typeof manifest.availability?.production !== "boolean") {
        problems.push(`${gameId}: manifest.availability must explicitly declare development and production booleans`);
      }
      if (!["team", "versus", "individual", "arcade"].includes(String(manifest.catalog?.category))) {
        problems.push(`${gameId}: manifest.catalog.category must be team, versus, individual, or arcade`);
      }
      if (!/^#[0-9a-f]{6}$/iu.test(String(manifest.catalog?.color || ""))) {
        problems.push(`${gameId}: manifest.catalog.color must be a six-digit hex color`);
      }
      for (const field of ["durationLabel", "modeLabel", "audioLabel"] as const) {
        if (!String(manifest.catalog?.[field] || "").trim()) {
          problems.push(`${gameId}: manifest.catalog.${field} is required`);
        }
      }
      if (!isStringArray(manifest.catalog?.rules)) {
        problems.push(`${gameId}: manifest.catalog.rules must be a string array`);
      }
      if (!isFiniteNumber(manifest.defaultDurationMillis) || manifest.defaultDurationMillis < 0) {
        problems.push(`${gameId}: manifest.defaultDurationMillis must be a non-negative finite number`);
      }
      if (typeof manifest.players?.allowAny !== "boolean") {
        problems.push(`${gameId}: manifest.players.allowAny must explicitly declare true or false`);
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
        if (Number(manifest.players?.max) > 1 &&
          (!isFiniteNumber(manifest.start.releaseGraceMillis) ||
            manifest.start.releaseGraceMillis < 1_000 || manifest.start.releaseGraceMillis > 2_000)) {
          problems.push(
            `${gameId}: multiplayer player-ready games must declare manifest.start.releaseGraceMillis from 1000 to 2000`
          );
        }
      }
      if (manifest.display?.entry !== "./display") {
        problems.push(`${gameId}: manifest.display.entry must be ./display`);
      }
      validatePreviewScenario(gameId, manifest.preview, manifest.players, problems);
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
            if (typeof record.playerFacing !== "boolean") {
              problems.push(`${gameId}: manifest.config.vars[${index}].playerFacing must be a boolean`);
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

  await validateGameImports(gameId, gameRoot, problems);
}

async function validateGameImports(gameId: string, gameRoot: string, problemList: string[]): Promise<void> {
  const srcDir = path.join(gameRoot, "src");
  try {
    const entries = await readdir(srcDir, { recursive: true, withFileTypes: true });
    const sourceFiles = entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")))
      .map((entry) => path.join(entry.parentPath || srcDir, entry.name));

    const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]*\s+from\s+)?["\x27]([^"\x27]+)["\x27]|import\(\s*["\x27]([^"\x27]+)["\x27]\s*\)/g;

    for (const filePath of sourceFiles) {
      const content = await readFile(filePath, "utf8");
      const relativeFile = path.relative(gameRoot, filePath);
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const specifier = match[1] || match[2];
        if (!specifier || specifier.startsWith(".")) {
          continue;
        }
        const isAllowed = ALLOWED_GAME_IMPORT_PACKAGES.some(
          (pkg) => specifier === pkg || specifier.startsWith(pkg + "/")
        );
        if (!isAllowed) {
          problemList.push(
            `${gameId}: ${relativeFile} imports forbidden module "${specifier}". Games must only import from @motion-levels-games/game-sdk or @motion-levels-games/display-kit.`
          );
        }
      }
    }
  } catch (error) {
    problemList.push(`${gameId}: failed to scan src imports (${errorMessage(error)})`);
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

function validatePreviewScenario(
  gameId: string,
  preview: PreviewManifest | undefined,
  players: PlayersManifest | undefined,
  problemList: string[]
): void {
  if (!preview || !isInteger(preview.seed) || Number(preview.seed) < 0) {
    problemList.push(`${gameId}: manifest.preview.seed must be a non-negative integer`);
  }
  if (!preview || !isInteger(preview.playerCount) || Number(preview.playerCount) < 0) {
    problemList.push(`${gameId}: manifest.preview.playerCount must be a non-negative integer`);
  } else if (Number(preview.playerCount) === 0 && players?.allowAny !== true) {
    problemList.push(`${gameId}: manifest.preview.playerCount may be 0 only when players.allowAny is true`);
  }
  if (!preview || !isFiniteNumber(preview.captureStartMillis) || preview.captureStartMillis < 0) {
    problemList.push(`${gameId}: manifest.preview.captureStartMillis must be a non-negative finite number`);
  }
  if (!preview || !isInteger(preview.frameCount) || Number(preview.frameCount) < 1 || Number(preview.frameCount) > 120) {
    problemList.push(`${gameId}: manifest.preview.frameCount must be an integer from 1 to 120`);
  }
  if (!preview || !isFiniteNumber(preview.frameIntervalMillis) || preview.frameIntervalMillis <= 0) {
    problemList.push(`${gameId}: manifest.preview.frameIntervalMillis must be a positive finite number`);
  }
  if (!preview || !Array.isArray(preview.actions)) {
    problemList.push(`${gameId}: manifest.preview.actions must be an array`);
    return;
  }
  for (const [index, action] of preview.actions.entries()) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      problemList.push(`${gameId}: manifest.preview.actions[${index}] must be an object`);
      continue;
    }
    const record = action as Record<string, unknown>;
    if (!isFiniteNumber(record.atMillis) || record.atMillis < 0 || !["press", "release"].includes(String(record.type)) ||
      !isInteger(record.x) || Number(record.x) < 0 || Number(record.x) > 15 ||
      !isInteger(record.y) || Number(record.y) < 0 || Number(record.y) > 31) {
      problemList.push(`${gameId}: manifest.preview.actions[${index}] must contain a valid time, type, and 16x32 coordinate`);
    }
  }
}

function validateNumericConfigVar(
  gameId: string,
  index: number,
  configVar: Record<string, unknown>,
  problemList: string[]
): void {
  const prefix = `${gameId}: manifest.config.vars[${index}]`;
  if (!isFiniteNumber(configVar.default)) {
    problemList.push(`${prefix}.default must be a finite number`);
    return;
  }
  validateAbsentFields(gameId, index, configVar, ["options"], problemList);

  for (const field of ["min", "max", "step"] as const) {
    if (configVar[field] !== undefined && !isFiniteNumber(configVar[field])) {
      problemList.push(`${prefix}.${field} must be a finite number when present`);
    }
  }
  if (isFiniteNumber(configVar.min) && isFiniteNumber(configVar.max) && configVar.min > configVar.max) {
    problemList.push(`${prefix}.min must not exceed max`);
  }
  if (isFiniteNumber(configVar.min) && configVar.default < configVar.min) {
    problemList.push(`${prefix}.default must not be below min`);
  }
  if (isFiniteNumber(configVar.max) && configVar.default > configVar.max) {
    problemList.push(`${prefix}.default must not exceed max`);
  }
  if (isFiniteNumber(configVar.step) && configVar.step <= 0) {
    problemList.push(`${prefix}.step must be greater than zero`);
  }
  if (configVar.type === "int") {
    for (const field of ["default", "min", "max", "step"] as const) {
      if (isFiniteNumber(configVar[field]) && !Number.isInteger(configVar[field])) {
        problemList.push(`${prefix}.${field} must be an integer for int vars`);
      }
    }
  }
}

function validateEnumConfigVar(
  gameId: string,
  index: number,
  configVar: Record<string, unknown>,
  problemList: string[]
): void {
  const prefix = `${gameId}: manifest.config.vars[${index}]`;
  if (!Array.isArray(configVar.options) || configVar.options.length === 0) {
    problemList.push(`${prefix}.options must be a non-empty array for enum vars`);
    return;
  }

  const values = configVar.options.map((option) =>
    option && typeof option === "object" && !Array.isArray(option)
      ? String((option as Record<string, unknown>).value ?? "").trim()
      : ""
  );
  if (values.some((value) => value === "")) {
    problemList.push(`${prefix}.options must contain non-empty values`);
  }
  if (new Set(values).size !== values.length) {
    problemList.push(`${prefix}.options must not contain duplicate values`);
  }
  if (typeof configVar.default !== "string" || !values.includes(configVar.default)) {
    problemList.push(`${prefix}.default must match an enum option value`);
  }
}

function validateAbsentFields(
  gameId: string,
  index: number,
  configVar: Record<string, unknown>,
  fields: string[],
  problemList: string[]
): void {
  for (const field of fields) {
    if (configVar[field] !== undefined) {
      problemList.push(`${gameId}: manifest.config.vars[${index}].${field} is not valid for ${String(configVar.type)} vars`);
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
