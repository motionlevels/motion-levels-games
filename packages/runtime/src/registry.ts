import {
  gameManifestLookupKeys,
  type GameConfig,
  type GameInstance,
  type GameManifest
} from "@motion-levels-games/game-sdk";

export type GameplayModule = Readonly<{
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
}>;

export type GameplayRegistry = ReadonlyMap<string, GameplayModule>;

/** Builds a lookup index without coupling the reusable runtime to concrete games. */
export function buildGameplayRegistry(games: readonly GameplayModule[]): Map<string, GameplayModule> {
  const registry = new Map<string, GameplayModule>();
  for (const game of games) {
    for (const key of gameManifestLookupKeys(game.manifest)) {
      const existing = registry.get(key);
      if (existing && existing !== game) {
        throw new Error(
          `game identity collision: ${key} is declared by ${existing.manifest.id} and ${game.manifest.id}`
        );
      }
      registry.set(key, game);
    }
  }
  return registry;
}
