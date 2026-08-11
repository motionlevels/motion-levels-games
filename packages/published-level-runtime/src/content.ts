import { FLOOR_COLS, FLOOR_ROWS, type GameContent } from "@motion-levels-games/game-sdk";

import {
  PUBLISHED_LEVEL_CONTENT_SCHEMA,
  type PublishedAnimationRecord,
  type PublishedLevelCell,
  type PublishedLevelContent,
  type PublishedLevelContentInput,
  type PublishedLevelDifficultySetting,
  type PublishedLevelFrame,
  type PublishedLevelMode,
  type PublishedLevelRecord,
  type PublishedLevelRules,
  type PublishedResultAnimations
} from "./types.ts";

const MAX_LEVELS = 160;
const MAX_RESULT_ANIMATIONS = 160;
const MAX_FRAMES_PER_RECORD = 4_096;
const MAX_CELLS_PER_FRAME = FLOOR_COLS * FLOOR_ROWS * 2;

/**
 * Converts the public platform level response into the immutable document used
 * by the deterministic engine. It intentionally retains only authored fields
 * that affect gameplay, display, or audio.
 */
export function createPublishedLevelContent(input: PublishedLevelContentInput): PublishedLevelContent {
  const gameId = requiredStableId(input.gameId, "gameId");
  const engineGame = requiredString(input.engineGame, "engineGame", 120).toLowerCase();
  const rawLevels = recordsFromPayload(input.levelsPayload, "levelsPayload");
  if (rawLevels.length === 0) throw new Error("Published level content has no playable levels");
  if (rawLevels.length > MAX_LEVELS) {
    throw new Error(`Published level content exceeds the ${MAX_LEVELS} level limit`);
  }
  const levels = rawLevels.map((value, index) => normalizeLevelRecord(value, `levels[${index}]`));
  const levelIds = new Set<string>();
  for (const level of levels) {
    if (levelIds.has(level.id)) {
      throw new Error(`Published level content contains duplicate canonical level id ${level.id}`);
    }
    levelIds.add(level.id);
  }

  const rawAnimations = optionalRecordsFromPayload(input.resultAnimationsPayload, "resultAnimationsPayload");
  if (rawAnimations.length > MAX_RESULT_ANIMATIONS) {
    throw new Error(`Published level content exceeds the ${MAX_RESULT_ANIMATIONS} animation limit`);
  }
  const resultAnimations = rawAnimations.map((value, index) =>
    normalizeAnimationRecord(value, `resultAnimations[${index}]`)
  );
  const selection = resolveLevelSelection(levels, input.selectedLevelId, input.selectedLevelSlug);
  const selectedLevelId = selection.id;
  const selectedLevelSlug = selection.slug;
  if (input.mode !== undefined && input.mode !== "free" && input.mode !== "challenge") {
    throw new Error("mode must be challenge or free");
  }
  const mode: PublishedLevelMode = input.mode ?? "challenge";
  const suppliedRevision = input.contentRevision;
  if (suppliedRevision !== undefined && !/^[0-9a-f]{16,64}$/u.test(suppliedRevision)) {
    throw new Error("contentRevision must be 16 through 64 lowercase hexadecimal characters");
  }
  const contentRevision = suppliedRevision
    || contentHash({ gameId, engineGame, selectedLevelId, selectedLevelSlug, mode, levels, resultAnimations });

  return deepFreeze({
    schema: PUBLISHED_LEVEL_CONTENT_SCHEMA,
    gameId,
    engineGame,
    contentRevision,
    selectedLevelId,
    selectedLevelSlug,
    mode,
    levels,
    resultAnimations
  }) as PublishedLevelContent;
}

/** Validates a cloned GameConfig.content document at the game boundary. */
export function parsePublishedLevelContent(
  value: GameContent | undefined,
  expectedGameId: string,
  aliases: readonly string[] = []
): PublishedLevelContent {
  if (!value || value.schema !== PUBLISHED_LEVEL_CONTENT_SCHEMA) {
    throw new Error(`Expected ${PUBLISHED_LEVEL_CONTENT_SCHEMA} content`);
  }
  if (typeof value.contentRevision !== "string") {
    throw new Error("content.contentRevision must be supplied by the content boundary");
  }
  const canonicalExpectedGameId = requiredStableId(expectedGameId, "expectedGameId");
  const contentGameId = requiredStableId(value.gameId, "content.gameId");
  if (contentGameId !== canonicalExpectedGameId) {
    throw new Error(`Published level content is for ${contentGameId}, expected ${canonicalExpectedGameId}`);
  }
  // Kept for source compatibility with hosts that passed release-time aliases.
  // engineGame is mutable dispatch metadata; canonical gameId is the authority.
  void aliases;
  const parsed = createPublishedLevelContent({
    gameId: contentGameId,
    engineGame: requiredString(value.engineGame, "content.engineGame", 120),
    contentRevision: value.contentRevision,
    selectedLevelId: optionalText(value.selectedLevelId, 120) || undefined,
    selectedLevelSlug: optionalText(value.selectedLevelSlug, 120) || undefined,
    mode: value.mode as PublishedLevelMode,
    levelsPayload: value.levels,
    resultAnimationsPayload: value.resultAnimations
  });
  return parsed;
}

export function normalizeLevelId(value: string): string {
  const clean = optionalText(value, 120).toLowerCase();
  if (!clean || clean === "starter") return "level-1";
  const numeric = /^(?:(?:nivel|level)[\s-]*)?(\d+)$/u.exec(clean);
  return numeric ? `level-${Math.max(1, Number(numeric[1]))}` : clean;
}

function recordsFromPayload(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value) || !Array.isArray(value.levels)) {
    throw new Error(`${path} must be an array or an object with a levels array`);
  }
  return value.levels;
}

function optionalRecordsFromPayload(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return [];
  return recordsFromPayload(value, path);
}

function normalizeLevelRecord(value: unknown, path: string): PublishedLevelRecord {
  const record = requiredRecord(value, path);
  const id = requiredStableId(record.id, `${path}.id`);
  const slugSource = requiredText(record.slug, `${path}.slug`, 120);
  const slug = normalizeLevelId(slugSource);
  const frames = normalizeFrames(record.frames, `${path}.frames`);
  if (frames.length === 0) throw new Error(`${path}.frames must contain at least one frame`);
  const rules = normalizeRules(record.rules, `${path}.rules`);
  const resultAnimations = normalizeResultAnimations(record.result_animations, `${path}.result_animations`);

  return compactObject({
    id,
    slug,
    settings_hash: optionalText(record.settings_hash, 160) || undefined,
    label: optionalText(record.label, 160) || levelLabel(slug),
    description: optionalText(record.description, 500) || undefined,
    difficulty: optionalText(record.difficulty, 40).toLowerCase() || undefined,
    life: optionalInteger(record.life, 0, 99, `${path}.life`),
    pass_score: optionalInteger(record.pass_score, 0, 100_000, `${path}.pass_score`),
    time_limit_seconds: optionalInteger(record.time_limit_seconds, 0, 86_400, `${path}.time_limit_seconds`),
    frame_tick_ms: optionalInteger(record.frame_tick_ms, 1, 60_000, `${path}.frame_tick_ms`) ?? 25,
    rules,
    result_animations: resultAnimations,
    music_ref: optionalText(record.music_ref, 500) || undefined,
    music_volume: optionalFinite(record.music_volume, 0, 1, `${path}.music_volume`),
    narration_cue_ref: optionalText(record.narration_cue_ref, 500) || undefined,
    start_cue_ref: optionalText(record.start_cue_ref, 500) || undefined,
    coin_cue_ref: optionalText(record.coin_cue_ref, 500) || undefined,
    double_coin_cue_ref: optionalText(record.double_coin_cue_ref, 500) || undefined,
    damage_cue_ref: optionalText(record.damage_cue_ref, 500) || undefined,
    win_cue_ref: optionalText(record.win_cue_ref, 500) || undefined,
    defeat_cue_ref: optionalText(record.defeat_cue_ref, 500) || undefined,
    frames
  }) as PublishedLevelRecord;
}

function normalizeAnimationRecord(value: unknown, path: string): PublishedAnimationRecord {
  const record = requiredRecord(value, path);
  const slug = optionalText(record.slug ?? record.id, 120).toLowerCase();
  if (!slug) throw new Error(`${path} requires slug or id`);
  const frames = normalizeFrames(record.frames, `${path}.frames`);
  if (frames.length === 0) throw new Error(`${path}.frames must contain at least one frame`);
  const effects = record.tile_effects === undefined
    ? {}
    : requiredRecord(record.tile_effects, `${path}.tile_effects`);
  const tileEffects = Object.fromEntries(Object.entries(effects).map(([kind, effect]) => {
    const effectRecord = requiredRecord(effect, `${path}.tile_effects.${kind}`);
    const color = normalizeHex(effectRecord.color);
    if (!color) throw new Error(`${path}.tile_effects.${kind}.color must be a six-digit hex color`);
    return [kind, { color }];
  }));

  return compactObject({
    id: optionalText(record.id, 120) || undefined,
    slug,
    frame_tick_ms: optionalInteger(record.frame_tick_ms, 1, 60_000, `${path}.frame_tick_ms`) ?? 50,
    tile_effects: tileEffects,
    frames
  }) as PublishedAnimationRecord;
}

function resolveLevelSelection(
  levels: readonly PublishedLevelRecord[],
  requestedId: string | undefined,
  requestedSlug: string | undefined
): PublishedLevelRecord {
  const cleanId = optionalText(requestedId, 120).toLowerCase();
  const cleanSlug = requestedSlug ? normalizeLevelId(requestedSlug) : "";
  let selected: PublishedLevelRecord | undefined;
  if (cleanId) {
    selected = levels.find((level) => level.id.toLowerCase() === cleanId);
    if (!selected) {
      const legacyMatches = levels.filter((level) => normalizeLevelId(level.slug) === normalizeLevelId(cleanId));
      if (legacyMatches.length > 1) {
        throw new Error(`Legacy selected level alias ${cleanId} is ambiguous`);
      }
      selected = legacyMatches[0];
      if (!selected) throw new Error(`Selected level ${cleanId} is not present in content`);
    }
  } else if (cleanSlug) {
    const matches = levels.filter((level) => normalizeLevelId(level.slug) === cleanSlug);
    if (matches.length !== 1) throw new Error(`Selected level slug ${cleanSlug} is not uniquely resolvable`);
    selected = matches[0];
  } else {
    selected = levels[0];
  }
  if (!selected) throw new Error("Published level content has no selected level");
  if (cleanSlug && normalizeLevelId(selected.slug) !== cleanSlug) {
    throw new Error(`selectedLevelSlug ${cleanSlug} does not match selectedLevelId ${selected.id}`);
  }
  return selected;
}

function normalizeFrames(value: unknown, path: string): PublishedLevelFrame[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > MAX_FRAMES_PER_RECORD) {
    throw new Error(`${path} exceeds the ${MAX_FRAMES_PER_RECORD} frame limit`);
  }
  return value.map((raw, frameIndex): PublishedLevelFrame => {
    const record = requiredRecord(raw, `${path}[${frameIndex}]`);
    if (!Array.isArray(record.c)) throw new Error(`${path}[${frameIndex}].c must be an array`);
    if (record.c.length > MAX_CELLS_PER_FRAME) {
      throw new Error(`${path}[${frameIndex}].c exceeds the ${MAX_CELLS_PER_FRAME} cell limit`);
    }
    return {
      r: optionalInteger(record.r, 1, 1_000_000, `${path}[${frameIndex}].r`) ?? 1,
      c: record.c.map((cell, cellIndex) => normalizeCell(cell, `${path}[${frameIndex}].c[${cellIndex}]`))
    };
  });
}

function normalizeCell(value: unknown, path: string): PublishedLevelCell {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4) {
    throw new Error(`${path} must be [x, y, kind] or [x, y, kind, uniq]`);
  }
  const x = requiredInteger(value[0], 0, FLOOR_COLS - 1, `${path}[0]`);
  const y = requiredInteger(value[1], 0, FLOOR_ROWS - 1, `${path}[1]`);
  const kind = requiredInteger(value[2], 0, 255, `${path}[2]`);
  const uniq = optionalText(value[3], 120);
  return uniq ? [x, y, kind, uniq] : [x, y, kind];
}

function normalizeRules(value: unknown, path: string): PublishedLevelRules {
  const rules = value === undefined ? {} : requiredRecord(value, path);
  const victoryCondition = optionalText(rules.victory_condition, 40);
  if (victoryCondition && victoryCondition !== "collect_all" && victoryCondition !== "score_at_least") {
    throw new Error(`${path}.victory_condition is not supported`);
  }
  const redAnimation = optionalText(rules.red_floor_animation, 40);
  if (redAnimation && redAnimation !== "none" && redAnimation !== "parkour_lava") {
    throw new Error(`${path}.red_floor_animation is not supported`);
  }
  const loadSide = optionalText(rules.green_platform_load_side, 20);
  if (loadSide && loadSide !== "left" && loadSide !== "right") {
    throw new Error(`${path}.green_platform_load_side is not supported`);
  }

  return {
    victory_condition: victoryCondition,
    difficulty_changes_layout: rules.difficulty_changes_layout === true,
    difficulty_settings: normalizeDifficultySettings(rules.difficulty_settings, `${path}.difficulty_settings`),
    red_floor_animation: redAnimation,
    red_damage_grace_period: rules.red_damage_grace_period === true,
    green_platform_load_animation: rules.green_platform_load_animation !== false,
    green_platform_load_side: loadSide === "right" ? "right" : "left",
    green_platform_disappear: rules.green_platform_disappear === true,
    green_platform_impact_ripple: rules.green_platform_impact_ripple === true,
    blue_platform_turn_green: rules.blue_platform_turn_green === true,
    blue_platform_capture_area: rules.blue_platform_capture_area === true
  };
}

function normalizeResultAnimations(value: unknown, path: string): PublishedResultAnimations {
  const animations = value === undefined ? {} : requiredRecord(value, path);
  return {
    victory_animations: textList(animations.victory_animations, `${path}.victory_animations`),
    defeat_animations: textList(animations.defeat_animations, `${path}.defeat_animations`)
  };
}

function normalizeDifficultySettings(
  value: unknown,
  path: string
): Readonly<Record<string, PublishedLevelDifficultySetting>> {
  if (value === undefined) return {};
  const settings = requiredRecord(value, path);
  const entries = Object.entries(settings);
  if (entries.length > 12) throw new Error(`${path} exceeds the 12 difficulty limit`);
  return Object.fromEntries(entries.map(([key, raw]) => {
    const normalizedKey = requiredText(key, `${path} key`, 40).toLowerCase();
    const setting = requiredRecord(raw, `${path}.${normalizedKey}`);
    return [normalizedKey, compactObject({
      life: optionalInteger(setting.life, 0, 99, `${path}.${normalizedKey}.life`),
      frame_duration_ms: optionalInteger(
        setting.frame_duration_ms,
        0,
        60_000,
        `${path}.${normalizedKey}.frame_duration_ms`
      ),
      gameplay_lives: optionalInteger(
        setting.gameplay_lives,
        0,
        99,
        `${path}.${normalizedKey}.gameplay_lives`
      ),
      gameplay_time_limit_seconds: optionalInteger(
        setting.gameplay_time_limit_seconds,
        0,
        86_400,
        `${path}.${normalizedKey}.gameplay_time_limit_seconds`
      ),
      speed_multiplier: optionalFinite(
        setting.speed_multiplier,
        0,
        100,
        `${path}.${normalizedKey}.speed_multiplier`
      )
    })];
  }));
}

function textList(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > 32) throw new Error(`${path} exceeds the 32 item limit`);
  return value.map((entry, index) => requiredText(entry, `${path}[${index}]`, 120).toLowerCase());
}

function levelLabel(id: string): string {
  const match = /^level-(\d+)$/u.exec(id);
  return match ? `Nivel ${match[1]}` : id;
}

function normalizeHex(value: unknown): string {
  const clean = optionalText(value, 20).toLowerCase();
  return /^#[0-9a-f]{6}$/u.test(clean) ? clean : "";
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requiredText(value: unknown, path: string, max: number): string {
  const clean = optionalText(value, max);
  if (!clean) throw new Error(`${path} must be a non-empty string`);
  return clean;
}

function requiredString(value: unknown, path: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${path} must be a non-empty string`);
  return requiredText(value, path, max);
}

function requiredStableId(value: unknown, path: string): string {
  const clean = requiredString(value, path, 120);
  if (value !== clean) {
    throw new Error(`${path} must use its canonical representation without surrounding or control characters`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const hash = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/u;
  if (!uuid.test(clean) && !hash.test(clean)) {
    throw new Error(`${path} must be a canonical UUID or lowercase 32/40/64-character hash`);
  }
  return clean;
}

function optionalText(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return [...String(value).trim()]
    .filter((character) => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127)
    .join("")
    .slice(0, max);
}

function requiredInteger(value: unknown, min: number, max: number, path: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${path} must be an integer from ${min} through ${max}`);
  }
  return number;
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
  path: string
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredInteger(Number(value), min, max, path);
}

function optionalFinite(
  value: unknown,
  min: number,
  max: number,
  path: string
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${path} must be a number from ${min} through ${max}`);
  }
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as Partial<T>;
}

function contentHash(value: unknown): string {
  const source = stableStringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
