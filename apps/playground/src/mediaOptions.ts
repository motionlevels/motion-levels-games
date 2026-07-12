import type { GameConfigOptions, GameDifficulty } from "@motion-levels-games/game-sdk";
import type { PlaygroundMediaOptions } from "./mediaAssets.ts";

export type PlaygroundMediaSelection = {
  difficulty: GameDifficulty;
  gameId: string;
  options: GameConfigOptions;
  playerCount: number;
  seed: number;
};

export function playgroundMediaOptionsFor(
  gameId: string,
  selection: PlaygroundMediaSelection,
  overrides: PlaygroundMediaOptions = {}
): PlaygroundMediaOptions {
  if (gameId !== selection.gameId) {
    // Leave unspecified fields absent so generateGameMediaBundle can honor the
    // target manifest's authored preview scenario instead of generic defaults.
    return { ...overrides };
  }

  return {
    difficulty: selection.difficulty,
    playerCount: selection.playerCount,
    seed: selection.seed,
    ...overrides,
    options: overrides.options ?? selection.options
  };
}
