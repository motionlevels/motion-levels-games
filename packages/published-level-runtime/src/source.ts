import {
  AUTHORED_GAME_SOURCE_SCHEMA,
  PUBLISHED_LEVEL_CONTENT_SCHEMA,
  type AuthoredGameSourceManifest,
  type PublishedAnimationRecord,
  type PublishedLevelContent,
  type PublishedLevelRecord
} from "./types.ts";
import { createPublishedLevelContent, normalizeLevelId } from "./content.ts";

type SourceLevel = PublishedLevelRecord & Readonly<{ sort_order?: number }>;

export function createRepositoryAuthoredLevelContent(input: Readonly<{
  game: AuthoredGameSourceManifest;
  levels: readonly unknown[];
  resultAnimations: readonly unknown[];
  contentRevision: string;
}>): PublishedLevelContent {
  const game = validateAuthoredGameSourceManifest(input.game);
  const levels = [...input.levels] as SourceLevel[];
  if (levels.length === 0) throw new Error(`${game.engineGame} has no authored levels`);
  levels.sort((left, right) => (
    finiteSortOrder(left.sort_order) - finiteSortOrder(right.sort_order)
    || normalizeLevelId(String(left.slug ?? "")).localeCompare(normalizeLevelId(String(right.slug ?? "")))
    || difficultyRank(String(left.difficulty ?? ""), game.difficulties)
      - difficultyRank(String(right.difficulty ?? ""), game.difficulties)
    || String(left.id ?? "").localeCompare(String(right.id ?? ""))
  ));
  const defaultLevel = levels.find((level) => (
    normalizeLevelId(String(level.slug ?? "")) === normalizeLevelId(game.defaultLevelSlug)
    && String(level.difficulty ?? "").toLowerCase() === game.defaultDifficulty
  )) || levels.find((level) => normalizeLevelId(String(level.slug ?? "")) === normalizeLevelId(game.defaultLevelSlug));
  if (!defaultLevel) throw new Error(`${game.engineGame} default level ${game.defaultLevelSlug} is missing`);

  const resultAnimations = [...input.resultAnimations]
    .sort((left, right) => (
      String((left as PublishedAnimationRecord).id ?? "").localeCompare(String((right as PublishedAnimationRecord).id ?? ""))
      || String((left as PublishedAnimationRecord).slug ?? "").localeCompare(String((right as PublishedAnimationRecord).slug ?? ""))
    ));
  const content = createPublishedLevelContent({
    gameId: game.gameId,
    engineGame: game.engineGame,
    contentRevision: input.contentRevision,
    selectedLevelId: String(defaultLevel.id),
    selectedLevelSlug: String(defaultLevel.slug),
    mode: game.defaultMode,
    levelsPayload: levels,
    resultAnimationsPayload: { levels: resultAnimations as readonly PublishedAnimationRecord[] }
  });
  validateAuthoredContent(game, content);
  return content;
}

/**
 * The exact JSON shape hashed by the games compiler and by the platform
 * exporter. Selection state is deliberately excluded: it is a launch cursor,
 * not a different authored document.
 */
export function authoredContentRevisionPayload(
  game: AuthoredGameSourceManifest,
  content: PublishedLevelContent
): Readonly<Record<string, unknown>> {
  return {
    schema: PUBLISHED_LEVEL_CONTENT_SCHEMA,
    game: {
      schema: AUTHORED_GAME_SOURCE_SCHEMA,
      gameId: game.gameId,
      engineGame: game.engineGame,
      difficulties: game.difficulties,
      defaultDifficulty: game.defaultDifficulty,
      defaultMode: game.defaultMode,
      defaultLevelSlug: game.defaultLevelSlug
    },
    levels: content.levels,
    resultAnimations: content.resultAnimations
  };
}

export function validateAuthoredGameSourceManifest(value: AuthoredGameSourceManifest): AuthoredGameSourceManifest {
  if (!value || value.schema !== AUTHORED_GAME_SOURCE_SCHEMA) {
    throw new Error(`Expected ${AUTHORED_GAME_SOURCE_SCHEMA} game source`);
  }
  const difficulties = [...new Set((value.difficulties ?? []).map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  if (difficulties.length === 0) throw new Error("Authored game source requires difficulties");
  const gameId = String(value.gameId ?? "").trim().toLowerCase();
  if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/u.test(gameId)) {
    throw new Error("gameId must be a canonical UUID or lowercase hash");
  }
  if (gameId !== String(value.gameId ?? "")) throw new Error("gameId must be lowercase and trimmed");
  const engineGame = String(value.engineGame ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/u.test(engineGame)) throw new Error("engineGame must be a stable slug");
  if (engineGame !== String(value.engineGame ?? "")) throw new Error("engineGame must be lowercase and trimmed");
  const defaultDifficulty = String(value.defaultDifficulty ?? "").trim().toLowerCase();
  if (!difficulties.includes(defaultDifficulty)) throw new Error("defaultDifficulty must be listed in difficulties");
  const defaultMode = value.defaultMode;
  if (defaultMode !== "challenge" && defaultMode !== "free") throw new Error("defaultMode must be challenge or free");
  const defaultLevelSlug = normalizeLevelId(String(value.defaultLevelSlug ?? ""));
  if (!defaultLevelSlug) throw new Error("defaultLevelSlug is required");
  return Object.freeze({
    schema: AUTHORED_GAME_SOURCE_SCHEMA,
    gameId,
    engineGame,
    difficulties: Object.freeze(difficulties),
    defaultDifficulty,
    defaultMode,
    defaultLevelSlug
  });
}

function finiteSortOrder(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : Number.MAX_SAFE_INTEGER;
}

function difficultyRank(value: string, difficulties: readonly string[]): number {
  const index = difficulties.indexOf(value.trim().toLowerCase());
  return index < 0 ? difficulties.length : index;
}

function validateAuthoredContent(
  game: AuthoredGameSourceManifest,
  content: PublishedLevelContent
): void {
  const levelKeys = new Set<string>();
  let gameHasSafeRegion = false;
  for (const level of content.levels) {
    const difficulty = String(level.difficulty ?? "").toLowerCase();
    if (!game.difficulties.includes(difficulty)) {
      throw new Error(`${game.engineGame} level ${level.id} uses unsupported difficulty ${difficulty || "<missing>"}`);
    }
    const slug = normalizeLevelId(level.slug);
    const key = `${slug}\u0000${difficulty}`;
    if (levelKeys.has(key)) throw new Error(`${game.engineGame} duplicates level slug/difficulty ${slug}/${difficulty}`);
    levelKeys.add(key);
    if (!level.frames.length || !level.frames[0]!.c.length) {
      throw new Error(`${game.engineGame} level ${level.id} has no first-frame cells`);
    }
    const firstFrameHasSafe = level.frames[0]!.c.some((cell) => cell[2] !== 2);
    if (firstFrameHasSafe) gameHasSafeRegion = true;
    const objectives = level.frames.some((frame) => frame.c.some((cell) => (
      (cell[2] === 1 || cell[2] === 3) && typeof cell[3] === "string" && cell[3].length > 0
    )));
    if (!objectives) throw new Error(`${game.engineGame} level ${level.id} has no uniquely identified objective`);
    const difficultySettings = level.rules?.difficulty_settings ?? {};
    for (const settingKey of Object.keys(difficultySettings)) {
      if (!SUPPORTED_DIFFICULTIES.has(settingKey)) {
        throw new Error(`${game.engineGame} level ${level.id} has settings for unsupported difficulty ${settingKey}`);
      }
    }
    for (const referenceKey of AUTHORED_AUDIO_REFERENCE_KEYS) {
      const reference = level[referenceKey];
      if (reference !== undefined && reference !== "" && (
        typeof reference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/u.test(reference)
      )) {
        throw new Error(`${game.engineGame} level ${level.id} has an invalid ${referenceKey}`);
      }
    }
  }
  if (!gameHasSafeRegion) throw new Error(`${game.engineGame} has no safe first-frame region`);

  const animationIds = new Set<string>();
  const animationSlugs = new Set<string>();
  for (const animation of content.resultAnimations) {
    const id = animation.id?.toLowerCase();
    const slug = normalizeLevelId(animation.slug);
    if (!id) throw new Error(`${game.engineGame} result animation ${animation.slug} has no stable id`);
    if (animationIds.has(id)) throw new Error(`${game.engineGame} duplicates result animation id ${id}`);
    if (animationSlugs.has(slug)) throw new Error(`${game.engineGame} duplicates result animation slug ${slug}`);
    animationIds.add(id);
    animationSlugs.add(slug);
  }
  for (const level of content.levels) {
    for (const reference of [
      ...(level.result_animations?.victory_animations ?? []),
      ...(level.result_animations?.defeat_animations ?? [])
    ]) {
      const clean = reference.toLowerCase();
      if (!animationIds.has(clean) && !animationSlugs.has(normalizeLevelId(clean))) {
        throw new Error(`${game.engineGame} level ${level.id} references missing result animation ${reference}`);
      }
    }
  }
}

const SUPPORTED_DIFFICULTIES = new Set(["easy", "medium", "hard", "expert"]);
const AUTHORED_AUDIO_REFERENCE_KEYS = [
  "music_ref",
  "narration_cue_ref",
  "start_cue_ref",
  "coin_cue_ref",
  "double_coin_cue_ref",
  "damage_cue_ref",
  "win_cue_ref",
  "defeat_cue_ref"
] as const;
