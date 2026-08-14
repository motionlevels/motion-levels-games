import { allDifficultyIDs, difficultyLabels } from "./difficulties";
import type { PlatformGameCatalogEntry } from "./api";
import type { DifficultyID, GameCard, GameConfigVar, GameConfigVarType, GameLevel } from "./catalog";

export const catalogDifficultyIDs = allDifficultyIDs;

export type PlayerBounds = {
  maxPlayers: number;
  minPlayers: number;
};

export const noPlayerRequirementLabel = "Sin requisito";

function playerRequirementKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function gameRequiresPlayerCount(game: Pick<GameCard, "allowAnyPlayers" | "players">): boolean {
  if (game.allowAnyPlayers) return false;
  return !["", "todos", "sin selector", "sin requisito", "sin limite", "sin jugadores", "no aplica", "none", "hidden", "n/a"].includes(playerRequirementKey(game.players));
}

export function normalizeEstimatedDurationSeconds(value: unknown): number {
  return clampInteger(value, 0, 24 * 60 * 60, 0);
}

export function estimatedDurationLabel(seconds: number): string {
  const clean = normalizeEstimatedDurationSeconds(seconds);
  if (clean <= 0) return "";
  if (clean < 60) return `${clean}s`;
  const minutes = Math.round(clean / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes ? `${hours}h ${remainderMinutes} min` : `${hours}h`;
}

export function platformDurationLabel(
  entry: Pick<PlatformGameCatalogEntry, "estimated_duration_seconds">,
): string {
  return estimatedDurationLabel(entry.estimated_duration_seconds);
}

export function platformSupportsLevels(
  entry: Pick<PlatformGameCatalogEntry, "supports_levels">,
): boolean {
  return entry.supports_levels === true;
}

export function shouldPreferCatalogFallbackPreviewAnimation(
  entry: Pick<PlatformGameCatalogEntry, "source_kind">,
  fallback?: Pick<GameCard, "previewAnimation" | "previewSrc" | "previewSrcs" | "thumbnailSrc" | "thumbnailSrcs">,
): boolean {
  return Boolean(
    fallback?.previewAnimation
    && !fallback.thumbnailSrc
    && !fallback.thumbnailSrcs?.length
    && !fallback.previewSrc
    && !fallback.previewSrcs?.length
    && entry.source_kind !== "platform_levels"
    && entry.source_kind !== "animation",
  );
}

const gameConfigVarTypes = ["int", "float", "bool", "enum"] as const satisfies readonly GameConfigVarType[];

const playerConfigSourceSchemas = new Set(["motion-levels-games-v2"]);

/**
 * Player-facing config vars declared by a playable game source
 * (config.vars[].player_facing). They power the game card's settings dialog.
 */
export function platformPlayerConfigVars(
  entry: Pick<PlatformGameCatalogEntry, "game_source">,
): GameConfigVar[] | undefined {
  const source = entry.game_source;
  if (!source || !playerConfigSourceSchemas.has(String(source.schema || ""))) return undefined;
  const config = source.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const rawVars = (config as { vars?: unknown }).vars;
  if (!Array.isArray(rawVars)) return undefined;
  const seen = new Set<string>();
  const vars = rawVars.flatMap((item): GameConfigVar[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (record.player_facing !== true && record.playerFacing !== true) return [];
    const key = String(record.key || "").trim();
    if (!key || seen.has(key)) return [];
    const type = gameConfigVarTypes.includes(record.type as GameConfigVarType) ? record.type as GameConfigVarType : "int";
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option): NonNullable<GameConfigVar["options"]> => {
          const value = String((option as Record<string, unknown>)?.value ?? "").trim();
          if (!value) return [];
          const label = String((option as Record<string, unknown>)?.label ?? "").trim();
          return [{ value, ...(label ? { label } : {}) }];
        })
      : undefined;
    if (type === "enum" && !options?.length) return [];
    seen.add(key);
    const min = finiteNumberOrUndefined(record.min);
    const max = finiteNumberOrUndefined(record.max);
    const step = finiteNumberOrUndefined(record.step);
    const defaultValue = type === "bool"
      ? record.default === true
      : type === "enum"
        ? (options?.some((option) => option.value === record.default) ? record.default as string : options?.[0]?.value)
        : finiteNumberOrUndefined(record.default);
    return [{
      key,
      label: String(record.label || "").trim() || key,
      ...(record.description ? { description: String(record.description).trim() } : {}),
      type,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined && step > 0 ? { step } : {}),
      ...(options?.length ? { options } : {}),
    }];
  }).slice(0, 24);
  return vars.length ? vars : undefined;
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function normalizeDifficultyIDs(value: unknown): DifficultyID[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<DifficultyID>();
  for (const item of value) {
    if (catalogDifficultyIDs.includes(item as DifficultyID)) {
      seen.add(item as DifficultyID);
    }
  }
  return catalogDifficultyIDs.filter((difficulty) => seen.has(difficulty));
}

export function platformPlayerBounds(entry: Pick<PlatformGameCatalogEntry, "max_players" | "min_players">): PlayerBounds {
  const minPlayers = clampInteger(entry.min_players, 1, 99, 1);
  const maxPlayers = Math.max(minPlayers, clampInteger(entry.max_players, 1, 99, minPlayers));
  return { maxPlayers, minPlayers };
}

export function platformPlayerRangeLabel(entry: Pick<PlatformGameCatalogEntry, "allow_any_players" | "catalog_category" | "max_players" | "min_players" | "players_label">): string {
  if (entry.catalog_category === "attract") return "Todos";
  if (entry.allow_any_players || !gameRequiresPlayerCount({ allowAnyPlayers: false, players: entry.players_label })) return noPlayerRequirementLabel;
  const { maxPlayers, minPlayers } = platformPlayerBounds(entry);
  return minPlayers === maxPlayers ? String(minPlayers) : `${minPlayers}-${maxPlayers}`;
}

export function platformSupportedDifficulties(
  entry: Pick<PlatformGameCatalogEntry, "difficulties">,
): DifficultyID[] | undefined {
  const supported = normalizeDifficultyIDs(entry.difficulties);
  if (supported.length) return supported;
  return undefined;
}

export function platformLevelSupportedDifficulties(
  level: { difficulties?: string[]; difficulty?: string; rules?: Record<string, unknown> },
): DifficultyID[] | undefined {
  const explicit = normalizeDifficultyIDs(level.difficulties);
  if (explicit.length) return explicit;

  const settings = level.rules?.difficulty_settings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const configured = normalizeDifficultyIDs(Object.keys(settings));
    if (configured.length) return configured;
  }

  const single = normalizeDifficultyIDs(level.difficulty ? [level.difficulty] : []);
  if (single.length) return single;
  return undefined;
}

export function platformDifficultyLabel(
  entry: Pick<PlatformGameCatalogEntry, "catalog_category" | "difficulties" | "source_kind">,
): string {
  if (entry.catalog_category === "attract" || entry.source_kind === "animation") return "Ambiente";
  const supported = platformSupportedDifficulties(entry);
  if (supported?.length === catalogDifficultyIDs.length) return "Fácil-Experto";
  if (supported && supported.length > 1) {
    return `${difficultyLabels[supported[0]]}-${difficultyLabels[supported[supported.length - 1]]}`;
  }
  if (supported?.length === 1) return difficultyLabels[supported[0]];
  return "Juego";
}

export function supportedDifficultiesForGame(game: Pick<GameCard, "difficulties">, level?: Pick<GameLevel, "difficulties">): DifficultyID[] {
  const gameSupported = game.difficulties?.length ? game.difficulties : [...catalogDifficultyIDs];
  if (!level?.difficulties?.length) return gameSupported;
  const levelSupported = level.difficulties.filter((difficulty) => gameSupported.includes(difficulty));
  return levelSupported.length ? levelSupported : gameSupported;
}

export function difficultyRank(difficulty: DifficultyID): number {
  return catalogDifficultyIDs.indexOf(difficulty);
}

export function closestSupportedDifficulty(requested: DifficultyID, supported: DifficultyID[]): DifficultyID {
  if (supported.includes(requested)) return requested;
  const fallback = supported[0] || catalogDifficultyIDs[0];
  return supported.reduce((best, candidate) => {
    const bestDistance = Math.abs(difficultyRank(best) - difficultyRank(requested));
    const candidateDistance = Math.abs(difficultyRank(candidate) - difficultyRank(requested));
    if (candidateDistance !== bestDistance) return candidateDistance < bestDistance ? candidate : best;
    return difficultyRank(candidate) > difficultyRank(best) ? candidate : best;
  }, fallback);
}

export function playerBoundsForGame(
  game: Pick<GameCard, "allowAnyPlayers" | "engineGame" | "id" | "category" | "maxPlayers" | "minPlayers" | "players">,
): PlayerBounds {
  if (game.allowAnyPlayers) return { minPlayers: 0, maxPlayers: 99 };
  if (typeof game.players === "string" && !gameRequiresPlayerCount(game)) return { minPlayers: 1, maxPlayers: 99 };
  if (Number.isFinite(game.minPlayers) && Number.isFinite(game.maxPlayers)) {
    const minPlayers = clampInteger(game.minPlayers, 1, 99, 1);
    const maxPlayers = Math.max(minPlayers, clampInteger(game.maxPlayers, 1, 99, minPlayers));
    return { maxPlayers, minPlayers };
  }
  if (game.category === "individual") return { minPlayers: 1, maxPlayers: 1 };
  return { minPlayers: 1, maxPlayers: 6 };
}

export function rosterForGame<T extends { active: boolean }>(
  game: Pick<GameCard, "allowAnyPlayers" | "engineGame" | "id" | "category" | "maxPlayers" | "minPlayers" | "players">,
  players: T[],
): T[] {
  if (game.allowAnyPlayers) return [];
  const { maxPlayers } = playerBoundsForGame(game);
  return players.filter((player) => player.active).slice(0, maxPlayers);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, Math.round(next)));
}
