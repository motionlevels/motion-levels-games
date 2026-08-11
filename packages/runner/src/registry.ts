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
import * as parkour from "@motion-levels-games/parkour";
import * as patrones from "@motion-levels-games/patrones";
import * as pingPong from "@motion-levels-games/ping-pong";
import * as pingPongV2 from "@motion-levels-games/ping-pong-v2";
import * as pulso from "@motion-levels-games/pulso";
import * as saltos from "@motion-levels-games/saltos";
import * as sueloSeguro from "@motion-levels-games/suelo-seguro";
import * as temporada1Niveles from "@motion-levels-games/temporada1-niveles";
import * as tiraSoga from "@motion-levels-games/tira-soga";
import * as tetris from "@motion-levels-games/tetris";
import * as whackAMole from "@motion-levels-games/whack-a-mole";
import {
  gameManifestLookupKeys,
  gameManifestSlug,
  type GameConfig,
  type GameInstance,
  type GameManifest
} from "@motion-levels-games/game-sdk";

export type RunnerGameModule = {
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
  PlayerDisplay: unknown;
};

const registeredGames: RunnerGameModule[] = [
  arkanoid,
  cruceGalactico,
  duelo,
  equilibrio,
  estela,
  guardianes,
  helloWorld,
  lava,
  memoryChallenge,
  memoriaV2,
  meteorDodge,
  parkour,
  patrones,
  pingPong,
  pingPongV2,
  pulso,
  saltos,
  sueloSeguro,
  temporada1Niveles,
  tetris,
  tiraSoga,
  whackAMole
];

/** Canonical UUID/hash keys plus unique mutable aliases for launch compatibility. */
export const gameRegistry = buildGameRegistry(registeredGames);

/** Exactly one package module per directory slug; used by validation and media tooling. */
export const gamePackageRegistry = new Map(
  registeredGames.map((game) => [gameManifestSlug(game.manifest), game] as const)
);

export const gameCatalog = registeredGames
  .map((game) => game.manifest)
  .sort((left, right) => left.id.localeCompare(right.id));

export function buildGameRegistry(games: readonly RunnerGameModule[]): Map<string, RunnerGameModule> {
  const registry = new Map<string, RunnerGameModule>();
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
