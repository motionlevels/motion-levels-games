import * as arkanoid from "@motion-levels-games/arkanoid";
import * as duelo from "@motion-levels-games/duelo";
import * as helloWorld from "@motion-levels-games/hello-world";
import * as lava from "@motion-levels-games/lava";
import * as memoriaV2 from "@motion-levels-games/memoria-v2";
import * as meteorDodge from "@motion-levels-games/meteor-dodge";
import * as patrones from "@motion-levels-games/patrones";
import * as pingPong from "@motion-levels-games/ping-pong";
import * as saltos from "@motion-levels-games/saltos";
import * as tiraSoga from "@motion-levels-games/tira-soga";
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
  [lava.manifest.id, lava],
  [memoriaV2.manifest.id, memoriaV2],
  [meteorDodge.manifest.id, meteorDodge],
  [patrones.manifest.id, patrones],
  [pingPong.manifest.id, pingPong],
  [saltos.manifest.id, saltos],
  [tiraSoga.manifest.id, tiraSoga]
]);

export const gameCatalog = [...gameRegistry.values()]
  .map((game) => game.manifest)
  .sort((left, right) => left.id.localeCompare(right.id));
