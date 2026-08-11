export const allDifficultyIDs = ["easy", "medium", "hard", "expert"] as const;

export type DifficultyID = typeof allDifficultyIDs[number];

export const difficultyLabels: Record<DifficultyID, string> = {
  easy: "Fácil",
  medium: "Media",
  hard: "Difícil",
  expert: "Experto",
};

export function isDifficultyID(value: unknown): value is DifficultyID {
  return allDifficultyIDs.includes(value as DifficultyID);
}
