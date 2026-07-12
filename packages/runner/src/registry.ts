import * as arkanoid from "@motion-levels-games/arkanoid";
import * as duelo from "@motion-levels-games/duelo";
import * as helloWorld from "@motion-levels-games/hello-world";
import * as meteorDodge from "@motion-levels-games/meteor-dodge";
import * as pingPong from "@motion-levels-games/ping-pong";
import type { GameConfig, GameInstance, GameManifest } from "@motion-levels-games/game-sdk";

export type RunnerGameModule = {
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
  PlayerDisplay: unknown;
};

export const gameRegistry = new Map<string, RunnerGameModule>([
  [arkanoid.manifest.id, arkanoid],
  [duelo.manifest.id, duelo],
  [helloWorld.manifest.id, helloWorld],
  [meteorDodge.manifest.id, meteorDodge],
  [pingPong.manifest.id, pingPong]
]);

export const gameCatalog = [...gameRegistry.values()]
  .map((game) => game.manifest)
  .sort((left, right) => left.id.localeCompare(right.id));
