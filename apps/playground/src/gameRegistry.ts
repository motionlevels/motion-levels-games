import type { ComponentType } from "react";
import {
  gameManifestLookupKeys,
  normalizeGameLookupKey,
  type Frame,
  type GameConfig,
  type GameInstance,
  type GameManifest,
  type GameSnapshot
} from "@motion-levels-games/game-sdk";
import type { SessionControllerFactory } from "@motion-levels-games/jugar-3d";

export type PlaygroundAgentProfile =
  | "mixed"
  | "cautious"
  | "balanced"
  | "bold"
  | "helper"
  | "explorer"
  | "expert";

export type PlaygroundGame = {
  manifest: GameManifest;
  createGame: (config: GameConfig) => GameInstance;
  PlayerDisplay: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  /** Product-owned controller attached to the shared Jugar 3D GameSession. */
  createSessionController?: SessionControllerFactory;
};

export type GameModule = {
  manifest?: GameManifest;
  createGame?: (config: GameConfig) => GameInstance;
  PlayerDisplay?: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  createSessionController?: SessionControllerFactory;
};

const defaultGameId = "ping-pong";
const gameModules = import.meta.glob<GameModule>("../../../games/*/src/index.ts", {
  eager: true
});

export const playgroundGames = Object.entries(gameModules)
  .map(([modulePath, module]) => normalizeGameModule(modulePath, module))
  .sort((left, right) => {
    if (gameManifestLookupKeys(left.manifest).includes(defaultGameId)) {
      return -1;
    }
    if (gameManifestLookupKeys(right.manifest).includes(defaultGameId)) {
      return 1;
    }

    return left.manifest.label.localeCompare(right.manifest.label);
  });

const firstGame = playgroundGames[0];

if (!firstGame) {
  throw new Error("No games found under games/*/src/index.ts.");
}

export const defaultGame: PlaygroundGame = firstGame;

export function findPlaygroundGame(gameId: string): PlaygroundGame | undefined {
  const lookupKey = normalizeGameLookupKey(gameId);
  return playgroundGames.find((game) => gameManifestLookupKeys(game.manifest).includes(lookupKey));
}

function normalizeGameModule(modulePath: string, module: GameModule): PlaygroundGame {
  if (!module.manifest || typeof module.createGame !== "function" || !module.PlayerDisplay) {
    throw new Error(`${modulePath} must export manifest, createGame, and PlayerDisplay.`);
  }

  return {
    manifest: module.manifest,
    createGame: module.createGame,
    PlayerDisplay: module.PlayerDisplay,
    ...(module.createSessionController
      ? { createSessionController: module.createSessionController }
      : {})
  };
}
