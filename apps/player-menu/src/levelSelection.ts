import type { DifficultyID, GameCard, GameLevel } from "./catalog";
import { closestSupportedDifficulty, supportedDifficultiesForGame } from "./catalogSync.ts";

export function selectableDifficultiesForGame(game: Pick<GameCard, "difficulties" | "levels">): DifficultyID[] {
  const gameSupported = supportedDifficultiesForGame(game);
  if (!game.levels?.length) return gameSupported;

  const levelSupported = new Set<DifficultyID>();
  for (const level of game.levels) {
    for (const difficulty of supportedDifficultiesForGame(game, level)) {
      levelSupported.add(difficulty);
    }
  }
  const filtered = gameSupported.filter((difficulty) => levelSupported.has(difficulty));
  return filtered.length ? filtered : gameSupported;
}

export function levelSupportsDifficulty(
  game: Pick<GameCard, "difficulties">,
  level: Pick<GameLevel, "difficulties"> | undefined,
  difficulty: DifficultyID,
): boolean {
  if (!level) return false;
  return supportedDifficultiesForGame(game, level).includes(difficulty);
}

export function levelsForDifficulty(game: Pick<GameCard, "difficulties" | "levels">, difficulty: DifficultyID): GameLevel[] {
  const levels = game.levels || [];
  if (!levels.length) return [];
  const activeDifficulty = closestSupportedDifficulty(difficulty, selectableDifficultiesForGame(game));
  const filtered = levels.filter((level) => levelSupportsDifficulty(game, level, activeDifficulty));
  const available = filtered.length ? filtered : levels;
  return available.map((level) => {
    const canonicalID = level.canonicalIdsByDifficulty?.[activeDifficulty] || level.id;
    return canonicalID === level.id ? level : { ...level, id: canonicalID };
  });
}

export function defaultLevelIDForDifficulty(game: Pick<GameCard, "difficulties" | "levels">, difficulty: DifficultyID): string {
  return levelsForDifficulty(game, difficulty)[0]?.id || game.levels?.[0]?.id || "";
}

export function closestLevelIDForDifficulty(
  game: Pick<GameCard, "difficulties" | "levels">,
  levelID: string,
  difficulty: DifficultyID,
): string {
  const levels = game.levels || [];
  if (!levels.length) return "";
  const activeDifficulty = closestSupportedDifficulty(difficulty, selectableDifficultiesForGame(game));
  const currentLevel = levels.find((level) => levelMatchesID(level, levelID));
  if (currentLevel && levelSupportsDifficulty(game, currentLevel, activeDifficulty)) {
    return currentLevel.canonicalIdsByDifficulty?.[activeDifficulty] || currentLevel.id;
  }

  const available = levelsForDifficulty(game, activeDifficulty);
  if (!available.length) return levels[0]?.id || "";
  const currentIndex = levels.findIndex((level) => levelMatchesID(level, levelID));
  if (currentIndex < 0) return available[0].id;

  // Keep the player near where they were: pick the available level closest in
  // authored order, preferring the later one on ties.
  let closest = available[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const level of available) {
    const index = levels.findIndex((candidate) => levelMatchesID(candidate, level.id));
    const distance = Math.abs(index - currentIndex);
    if (distance < closestDistance || (distance === closestDistance && index > currentIndex)) {
      closest = level;
      closestDistance = distance;
    }
  }
  return closest.id;
}

function levelMatchesID(level: GameLevel, value: string): boolean {
  return level.id === value || level.slug === value || Object.values(level.canonicalIdsByDifficulty || {}).includes(value);
}

export function normalizedDifficultyForGame(game: Pick<GameCard, "difficulties" | "levels">, difficulty: DifficultyID): DifficultyID {
  return closestSupportedDifficulty(difficulty, selectableDifficultiesForGame(game));
}
