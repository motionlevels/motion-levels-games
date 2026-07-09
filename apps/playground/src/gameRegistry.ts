import type { ComponentType } from "react";
import type { Frame, GameConfig, GameInstance, GameManifest, GameSnapshot } from "@motion-levels-games/game-sdk";

export type PlaygroundGame = {
  manifest: GameManifest;
  createGame: (config: GameConfig) => GameInstance;
  PlayerDisplay: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
};

type GameModule = {
  manifest?: GameManifest;
  createGame?: (config: GameConfig) => GameInstance;
  PlayerDisplay?: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
};

const defaultGameId = "ping-pong";
const gameModules = import.meta.glob<GameModule>("../../../games/*/src/index.ts", {
  eager: true
});

export const playgroundGames = Object.entries(gameModules)
  .map(([modulePath, module]) => normalizeGameModule(modulePath, module))
  .sort((left, right) => {
    if (left.manifest.id === defaultGameId) {
      return -1;
    }
    if (right.manifest.id === defaultGameId) {
      return 1;
    }

    return left.manifest.label.localeCompare(right.manifest.label);
  });

const firstGame = playgroundGames[0];

if (!firstGame) {
  throw new Error("No games found under games/*/src/index.ts.");
}

export const defaultGame: PlaygroundGame = firstGame;

function normalizeGameModule(modulePath: string, module: GameModule): PlaygroundGame {
  if (!module.manifest || typeof module.createGame !== "function" || !module.PlayerDisplay) {
    throw new Error(`${modulePath} must export manifest, createGame, and PlayerDisplay.`);
  }

  return {
    manifest: module.manifest,
    createGame: module.createGame,
    PlayerDisplay: module.PlayerDisplay
  };
}
