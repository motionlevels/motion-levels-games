export type LifeMeterPlayer = {
  lives?: number | null;
};

export type LifeMeterModel = {
  visible: boolean;
  unlimited: boolean;
  lives: number;
  slots: number;
  lostIndexes: number[];
};

export function teamLivesFromPlayers(players: LifeMeterPlayer[] | undefined | null): number | null {
  if (!players?.length) return null;
  const finiteLives = players
    .map((player) => normalizedLives(player.lives))
    .filter((lives) => lives !== null && lives >= 0) as number[];
  if (finiteLives.length) return Math.max(...finiteLives);
  return players.some((player) => normalizedLives(player.lives) === -1) ? -1 : null;
}

export function lifeMeterModel(currentLives: number | null, previousLives: number | null, previousSlots = 0): LifeMeterModel {
  const lives = normalizedLives(currentLives);
  if (lives === null) {
    return { visible: false, unlimited: false, lives: 0, slots: 0, lostIndexes: [] };
  }
  if (lives < 0) {
    return { visible: true, unlimited: true, lives: -1, slots: 0, lostIndexes: [] };
  }
  const slots = Math.max(0, previousSlots, lives);
  const lostIndexes = previousLives !== null && previousLives > lives
    ? range(lives, Math.min(slots, previousLives))
    : [];
  return { visible: true, unlimited: false, lives, slots, lostIndexes };
}

function normalizedLives(value: unknown): number | null {
  const lives = Number(value);
  if (!Number.isFinite(lives)) return null;
  if (lives < 0) return -1;
  return Math.max(0, Math.floor(lives));
}

function range(start: number, end: number) {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}
