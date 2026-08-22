import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  AUTHORED_GAME_SOURCE_SCHEMA,
  authoredContentRevisionPayload,
  createRepositoryAuthoredLevelContent,
  validateAuthoredGameSourceManifest,
  type AuthoredGameSourceManifest,
  type PublishedLevelContent
} from "../packages/published-level-runtime/src/index.ts";

export const authoredContentBundleSchema = "motion-levels-authored-content-bundle-v1";
export const authoredContentLockSchema = "motion-levels-authored-content-lock-v2";

export type CompiledAuthoredGame = Readonly<{
  gameDir: string;
  game: AuthoredGameSourceManifest;
  content: PublishedLevelContent;
  outputPath: string;
}>;

export async function compileAuthoredContent(options: Readonly<{
  check?: boolean;
  format?: boolean;
  root?: string;
}> = {}): Promise<readonly CompiledAuthoredGame[]> {
  if (options.check && options.format) throw new Error("check and format are mutually exclusive");
  const root = path.resolve(options.root ?? process.cwd());
  const gamesRoot = path.join(root, "games");
  const sharedAnimationsRoot = path.join(root, "content", "result-animations");
  const gameDirs = (await readdir(gamesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const compiled: CompiledAuthoredGame[] = [];
  for (const gameDir of gameDirs) {
    const contentRoot = path.join(gamesRoot, gameDir, "content");
    const gamePath = path.join(contentRoot, "game.json");
    let gameSource: AuthoredGameSourceManifest;
    try {
      gameSource = await readSourceJSON<AuthoredGameSourceManifest>(gamePath, options);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (gameSource.schema !== AUTHORED_GAME_SOURCE_SCHEMA) throw new Error(`${gamePath} has an unsupported schema`);
    const game = validateAuthoredGameSourceManifest(gameSource);
    if (game.engineGame !== gameDir) throw new Error(`${gamePath} engineGame must match its game directory`);
    const levelFiles = await jsonFiles(path.join(contentRoot, "levels"));
    const legacyAnimationFiles = await jsonFiles(path.join(contentRoot, "result-animations"));
    if (legacyAnimationFiles.length > 0) {
      throw new Error(`${gameDir} result animations must live in content/result-animations and be referenced from game.json`);
    }
    const animationFiles = game.resultAnimationIds.map((id) => `${id}.json`);
    if (levelFiles.length === 0) throw new Error(`${gameDir} has no level source files`);
    const levels = await Promise.all(levelFiles.map(async (file) => {
      const value = await readSourceJSON<Record<string, unknown>>(
        path.join(contentRoot, "levels", file),
        options
      );
      assertIdentityFile(file, value.id, `${gameDir} level`);
      return value;
    }));
    const resultAnimations = await Promise.all(animationFiles.map(async (file) => {
      const value = await readSourceJSON<Record<string, unknown>>(
        path.join(sharedAnimationsRoot, file),
        options
      );
      assertIdentityFile(file, value.id, `${gameDir} result animation`);
      return value;
    }));
    const provisional = createRepositoryAuthoredLevelContent({
      game,
      levels,
      resultAnimations,
      contentRevision: "0".repeat(64)
    });
    const contentRevision = createHash("sha256")
      .update(canonicalJSONString(authoredContentRevisionPayload(game, provisional)))
      .digest("hex");
    const content = Object.freeze({ ...provisional, contentRevision }) as PublishedLevelContent;
    const trackedFiles = [
      { path: `games/${gameDir}/content/game.json`, file: gamePath },
      ...levelFiles.map((file) => ({
        path: `games/${gameDir}/content/levels/${file}`,
        file: path.join(contentRoot, "levels", file)
      })),
      ...animationFiles.map((file) => ({
        path: `content/result-animations/${file}`,
        file: path.join(sharedAnimationsRoot, file)
      }))
    ];
    const lock = {
      schema: authoredContentLockSchema,
      contentRevision,
      files: await Promise.all(trackedFiles.map(async (source) => {
        const value = await readJSON<unknown>(source.file);
        return { path: source.path, sha256: createHash("sha256").update(canonicalJSONString(value)).digest("hex") };
      }))
    };
    const generated = generatedModule(gameDir, game, levelFiles, animationFiles, contentRevision);
    const lockText = prettyJSON(lock);
    const generatedPath = path.join(gamesRoot, gameDir, "src/content.generated.ts");
    const lockPath = path.join(contentRoot, "content.lock.json");
    if (!options.check) {
      await writeFile(generatedPath, generated);
      await writeFile(lockPath, lockText);
    }
    const outputPath = path.join(root, "dist/authored-content", `${gameDir}.json`);
    if (!options.check) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, prettyJSON(content));
    }
    compiled.push(Object.freeze({ gameDir, game, content, outputPath }));
  }
  if (compiled.length === 0) throw new Error("No repository-authored games were discovered");
  return Object.freeze(compiled);
}

function generatedModule(
  gameDir: string,
  game: AuthoredGameSourceManifest,
  levels: readonly string[],
  animations: readonly string[],
  contentRevision: string
): string {
  const imports = [
    'import { createRepositoryAuthoredLevelContent } from "@motion-levels-games/published-level-runtime/source";',
    'import type { AuthoredGameSourceManifest } from "@motion-levels-games/published-level-runtime";',
    'import gameSource from "../content/game.json" with { type: "json" };',
    ...levels.map((file, index) => `import level${index} from "../content/levels/${file}" with { type: "json" };`),
    ...animations.map((file, index) => `import resultAnimation${index} from "../../../content/result-animations/${file}" with { type: "json" };`)
  ];
  return `${imports.join("\n")}\n\n// Generated by npm run content:build. Edit authored JSON sources, not this file.\nexport const fallbackContent = createRepositoryAuthoredLevelContent({\n  game: gameSource as AuthoredGameSourceManifest,\n  levels: [${levels.map((_, index) => `level${index}`).join(", ")}],\n  resultAnimations: [${animations.map((_, index) => `resultAnimation${index}`).join(", ")}],\n  contentRevision: ${JSON.stringify(contentRevision)}\n});\n\nexport const authoredContentSource = Object.freeze({\n  game: ${JSON.stringify(gameDir)},\n  gameId: ${JSON.stringify(game.gameId)},\n  contentRevision: fallbackContent.contentRevision\n});\n`;
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function assertIdentityFile(file: string, identity: unknown, label: string): void {
  const id = String(identity ?? "").trim().toLowerCase();
  if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/u.test(id)) {
    throw new Error(`${label} ${file} has an invalid stable id`);
  }
  if (file !== `${id}.json`) throw new Error(`${label} filename must be ${id}.json`);
}

function canonicalJSONString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSONString).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSONString(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function prettyJSON(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Deterministic authored-source format: structural arrays stay vertical,
 * while scalar tuples (notably floor cells) remain on one reviewable line. */
export function authoredSourceJSON(value: unknown): string {
  return `${formatJSONValue(value, 0)}\n`;
}

function formatJSONValue(value: unknown, depth: number): string {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  if (!value || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    if (primitive === undefined) throw new Error("Authored JSON cannot contain undefined");
    return primitive;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((item) => !item || typeof item !== "object")) {
      return `[${value.map((item) => formatJSONValue(item, depth)).join(", ")}]`;
    }
    return `[\n${value.map((item) => `${childIndent}${formatJSONValue(item, depth + 1)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  if (entries.every(([, item]) => !item || typeof item !== "object")) {
    const compact = `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${formatJSONValue(item, depth)}`).join(", ")} }`;
    if (indent.length + compact.length <= 160) return compact;
  }
  return `{\n${entries.map(([key, item]) => (
    `${childIndent}${JSON.stringify(key)}: ${formatJSONValue(item, depth + 1)}`
  )).join(",\n")}\n${indent}}`;
}

async function readSourceJSON<T>(
  file: string,
  options: Readonly<{ format?: boolean }>
): Promise<T> {
  const source = await readFile(file, "utf8");
  const value = JSON.parse(source) as T;
  const formatted = authoredSourceJSON(value);
  if (options.format && source !== formatted) await writeFile(file, formatted);
  return value;
}

async function readJSON<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
