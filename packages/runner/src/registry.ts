import * as arkanoid from "@motion-levels-games/arkanoid";
import * as cruceGalactico from "@motion-levels-games/cruce-galactico";
import * as duelo from "@motion-levels-games/duelo";
import * as equilibrio from "@motion-levels-games/equilibrio";
import * as estela from "@motion-levels-games/estela";
import * as guardianes from "@motion-levels-games/guardianes";
import * as helloWorld from "@motion-levels-games/hello-world";
import * as lava from "@motion-levels-games/lava";
import * as memoryChallenge from "@motion-levels-games/memory-challenge";
import * as memoriaV2 from "@motion-levels-games/memoria-v2";
import * as meteorDodge from "@motion-levels-games/meteor-dodge";
import * as patrones from "@motion-levels-games/patrones";
import * as pingPong from "@motion-levels-games/ping-pong";
import * as pingPongV2 from "@motion-levels-games/ping-pong-v2";
import * as pulso from "@motion-levels-games/pulso";
import * as saltos from "@motion-levels-games/saltos";
import * as tiraSoga from "@motion-levels-games/tira-soga";
import * as tetris from "@motion-levels-games/tetris";
import * as whackAMole from "@motion-levels-games/whack-a-mole";
import type { GameConfig, GameInstance, GameManifest } from "@motion-levels-games/game-sdk";

export type RunnerGameModule = {
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
  PlayerDisplay: unknown;
};

export const gameRegistry = new Map<string, RunnerGameModule>([
  [arkanoid.manifest.id, arkanoid],
  [cruceGalactico.manifest.id, cruceGalactico],
  [duelo.manifest.id, duelo],
  [equilibrio.manifest.id, equilibrio],
  [estela.manifest.id, estela],
  [guardianes.manifest.id, guardianes],
  [helloWorld.manifest.id, helloWorld],
  [lava.manifest.id, lava],
  [memoryChallenge.manifest.id, memoryChallenge],
  [memoriaV2.manifest.id, memoriaV2],
  [meteorDodge.manifest.id, meteorDodge],
  [patrones.manifest.id, patrones],
  [pingPong.manifest.id, pingPong],
  [pingPongV2.manifest.id, pingPongV2],
  [pulso.manifest.id, pulso],
  [saltos.manifest.id, saltos],
  [tetris.manifest.id, tetris],
  [tiraSoga.manifest.id, tiraSoga],
  [whackAMole.manifest.id, whackAMole]
]);

export const gameCatalog = [...gameRegistry.values()]
  .map((game) => game.manifest)
  .sort((left, right) => left.id.localeCompare(right.id));
