import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AUTHORED_GAME_EXPORT_SCHEMA,
  AUTHORED_GAME_SOURCE_SCHEMA,
  type AuthoredGameRepositoryExport,
  type AuthoredGameSourceManifest
} from "../packages/published-level-runtime/src/index.ts";
import { authoredSourceJSON } from "./authored-content.ts";

const args = process.argv.slice(2);
const gameDir = requiredOption("--game");
const root = process.cwd();
const gamePath = path.join(root, "games", gameDir, "content", "game.json");
const game = JSON.parse(await readFile(gamePath, "utf8")) as AuthoredGameSourceManifest;
if (game.schema !== AUTHORED_GAME_SOURCE_SCHEMA || game.engineGame !== gameDir) {
  throw new Error(`${gamePath} is not the ${gameDir} source manifest`);
}

const exportFile = option("--file");
const runtimeUrl = option("--runtime-url");
let published: AuthoredGameRepositoryExport;
if (exportFile) {
  published = JSON.parse(await readFile(path.resolve(exportFile), "utf8")) as AuthoredGameRepositoryExport;
} else if (runtimeUrl) {
  const difficulties = (option("--difficulties") || game.difficulties.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const gameId = option("--game-id") || game.gameId;
  const documents = [];
  for (const difficulty of difficulties) {
    const endpoint = new URL(`/api/level-games/${encodeURIComponent(gameId)}/repository-content`, runtimeUrl);
    endpoint.searchParams.set("difficulty", difficulty);
    endpoint.searchParams.set("mode", game.defaultMode);
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}: ${await response.text()}`);
    documents.push(await response.json() as Record<string, unknown>);
  }
  const levels = uniqueByIdentity(documents.flatMap((document) => arrayValue(document.levels)));
  const resultAnimations = uniqueByIdentity(documents.flatMap((document) => arrayValue(document.resultAnimations)));
  const source = {
    schema: AUTHORED_GAME_EXPORT_SCHEMA,
    game,
    levels,
    resultAnimations
  } as const;
  published = {
    ...source,
    sourceFingerprint: createHash("sha256").update(canonicalJSONString(source)).digest("hex")
  };
} else {
  throw new Error("Use --file <editor-export.json> or --runtime-url <legacy-platform-url>");
}

if (published.schema !== AUTHORED_GAME_EXPORT_SCHEMA) throw new Error(`Expected ${AUTHORED_GAME_EXPORT_SCHEMA}`);
if (published.game.gameId !== game.gameId || published.game.engineGame !== game.engineGame) {
  throw new Error("Published content identity does not match the target game");
}
await replaceIdentityDirectory(path.join(path.dirname(gamePath), "levels"), published.levels, "level");
const animationIds = await writeIdentityFiles(
  path.join(root, "content", "result-animations"),
  published.resultAnimations,
  "result animation"
);
await rm(path.join(path.dirname(gamePath), "result-animations"), { recursive: true, force: true });
await writeFile(gamePath, authoredSourceJSON({ ...game, resultAnimationIds: animationIds }));
console.log(`Imported ${published.levels.length} levels and ${published.resultAnimations.length} result animations for ${gameDir}`);

async function replaceIdentityDirectory(directory: string, values: readonly unknown[], label: string): Promise<void> {
  const expected = new Set(await writeIdentityFiles(directory, values, label).then((ids) => ids.map((id) => `${id}.json`)));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json") && !expected.has(entry.name)) {
      await rm(path.join(directory, entry.name));
    }
  }
}

async function writeIdentityFiles(
  directory: string,
  values: readonly unknown[],
  label: string
): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const expected = new Set<string>();
  const ids: string[] = [];
  for (const raw of values) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} must be an object`);
    const value = sourceRecord(raw as Record<string, unknown>, label);
    const id = String(value.id ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
      throw new Error(`${label} requires a canonical UUID`);
    }
    const name = `${id}.json`;
    if (expected.has(name)) throw new Error(`Duplicate ${label} id ${id}`);
    expected.add(name);
    ids.push(id);
    await writeFile(path.join(directory, name), authoredSourceJSON(value));
  }
  return ids.sort();
}

function sourceRecord(source: Record<string, unknown>, label: string): Record<string, unknown> {
  const keys = label === "level" ? [
    "id", "slug", "sort_order", "label", "description", "difficulty", "life", "pass_score",
    "time_limit_seconds", "frame_tick_ms", "rules", "result_animations", "music_ref", "music_volume",
    "narration_cue_ref", "start_cue_ref", "coin_cue_ref", "double_coin_cue_ref", "damage_cue_ref",
    "win_cue_ref", "defeat_cue_ref", "frames"
  ] : ["id", "slug", "label", "frame_tick_ms", "tile_effects", "frames"];
  return Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}

function uniqueByIdentity(values: readonly unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const id = String((value as Record<string, unknown>).id ?? "").trim().toLowerCase();
    if (!id) throw new Error("Published record is missing id");
    const previous = byId.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error(`Published record ${id} differs across difficulties`);
    byId.set(id, value);
  }
  return [...byId.values()];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function canonicalJSONString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSONString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJSONString(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function option(name: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? "").trim() : "";
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) throw new Error(`${name} is invalid`);
  return value;
}
