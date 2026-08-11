import type { DifficultyID, GameCard, GameLevel } from "./catalog";
import { isCanonicalEntityID } from "./identity.ts";

type MigratableLevelProgress = {
  unlockedThrough: number;
  bestByLevel: Record<string, DifficultyID>;
  bestTimeByLevel: Record<string, number>;
};

type MigratableChallengeRun = {
  difficulty: DifficultyID;
  startedUnixMillis: number;
  completedLevels: Record<string, number>;
  totalElapsedMillis: number;
  attemptCount: number;
};

export type MigratableLevelState = {
  difficulty: DifficultyID;
  selectedLevels: Record<string, string>;
  levelProgress: Record<string, MigratableLevelProgress>;
  challengeRuns: Record<string, MigratableChallengeRun>;
};

const difficultyOrder: DifficultyID[] = ["easy", "medium", "hard", "expert"];

function logicalLevel(game: Pick<GameCard, "levels">, value: string): GameLevel | undefined {
  return game.levels?.find((level) => (
    level.id === value
    || level.slug === value
    || Object.values(level.canonicalIdsByDifficulty || {}).includes(value)
  ));
}

function canonicalLevelID(game: Pick<GameCard, "levels">, value: string, difficulty: DifficultyID): string {
  const level = logicalLevel(game, value);
  if (!level) return "";
  if (isCanonicalEntityID(value)) return value;
  const canonicalID = level.canonicalIdsByDifficulty?.[difficulty] || level.id;
  return isCanonicalEntityID(canonicalID) ? canonicalID : "";
}

function strongerDifficulty(left: DifficultyID | undefined, right: DifficultyID): DifficultyID {
  if (!left) return right;
  return difficultyOrder.indexOf(right) > difficultyOrder.indexOf(left) ? right : left;
}

function fasterTime(left: number | undefined, right: number): number {
  if (left === undefined) return right;
  if (left <= 0) return right;
  if (right <= 0) return left;
  return Math.min(left, right);
}

function migrateSelectedLevels(state: MigratableLevelState, gamesByID: Map<string, GameCard>): { changed: boolean; value: Record<string, string> } {
  let changed = false;
  const value = { ...state.selectedLevels };
  for (const [gameID, storedLevelID] of Object.entries(state.selectedLevels)) {
    const game = gamesByID.get(gameID);
    if (!game) continue;
    const destination = canonicalLevelID(game, storedLevelID, state.difficulty);
    if (!destination || destination === storedLevelID) continue;
    value[gameID] = destination;
    changed = true;
  }
  return { changed, value };
}

function migrateProgress(progress: MigratableLevelProgress, game: GameCard): { changed: boolean; value: MigratableLevelProgress } {
  let changed = false;
  const bestByLevel: Record<string, DifficultyID> = {};
  for (const [storedLevelID, difficulty] of Object.entries(progress.bestByLevel || {})) {
    const destination = canonicalLevelID(game, storedLevelID, difficulty);
    const target = destination || storedLevelID;
    if (target !== storedLevelID) changed = true;
    bestByLevel[target] = strongerDifficulty(bestByLevel[target], difficulty);
  }

  const bestTimeByLevel: Record<string, number> = {};
  for (const [storedLevelID, elapsedMillis] of Object.entries(progress.bestTimeByLevel || {})) {
    // A best time belongs to the difficulty recorded by the corresponding
    // best entry. Without that evidence the legacy key is retained verbatim.
    const bestDifficulty = progress.bestByLevel?.[storedLevelID];
    const destination = bestDifficulty ? canonicalLevelID(game, storedLevelID, bestDifficulty) : "";
    const target = destination || storedLevelID;
    if (target !== storedLevelID) changed = true;
    bestTimeByLevel[target] = fasterTime(bestTimeByLevel[target], elapsedMillis);
  }

  if (!changed
    && Object.keys(bestByLevel).length === Object.keys(progress.bestByLevel || {}).length
    && Object.keys(bestTimeByLevel).length === Object.keys(progress.bestTimeByLevel || {}).length) {
    return { changed: false, value: progress };
  }
  return { changed: true, value: { ...progress, bestByLevel, bestTimeByLevel } };
}

function migrateChallengeRun(run: MigratableChallengeRun, game: GameCard): { changed: boolean; value: MigratableChallengeRun } {
  let changed = false;
  const completedLevels: Record<string, number> = {};
  for (const [storedLevelID, elapsedMillis] of Object.entries(run.completedLevels || {})) {
    const destination = canonicalLevelID(game, storedLevelID, run.difficulty);
    const target = destination || storedLevelID;
    if (target !== storedLevelID) changed = true;
    completedLevels[target] = fasterTime(completedLevels[target], elapsedMillis);
  }
  if (!changed && Object.keys(completedLevels).length === Object.keys(run.completedLevels || {}).length) {
    return { changed: false, value: run };
  }
  return {
    changed: true,
    value: {
      ...run,
      completedLevels,
      totalElapsedMillis: Object.values(completedLevels).reduce((sum, elapsed) => sum + Math.max(0, elapsed), 0),
    },
  };
}

// Idempotent and catalog-aware: the first catalog containing a game's
// canonical level rows rewrites its legacy keys. Unknown games and stale slugs
// remain untouched so a later catalog refresh can recover them safely.
export function migrateLegacyLevelState<T extends MigratableLevelState>(state: T, games: GameCard[]): T {
  const gamesByID = new Map(games.map((game) => [game.id, game]));
  const selected = migrateSelectedLevels(state, gamesByID);
  let changed = selected.changed;

  const levelProgress = { ...state.levelProgress };
  for (const [gameID, progress] of Object.entries(state.levelProgress)) {
    const game = gamesByID.get(gameID);
    if (!game) continue;
    const migrated = migrateProgress(progress, game);
    if (!migrated.changed) continue;
    levelProgress[gameID] = migrated.value;
    changed = true;
  }

  const challengeRuns = { ...state.challengeRuns };
  for (const [gameID, run] of Object.entries(state.challengeRuns)) {
    const game = gamesByID.get(gameID);
    if (!game) continue;
    const migrated = migrateChallengeRun(run, game);
    if (!migrated.changed) continue;
    challengeRuns[gameID] = migrated.value;
    changed = true;
  }

  if (!changed) return state;
  return { ...state, selectedLevels: selected.value, levelProgress, challengeRuns };
}
