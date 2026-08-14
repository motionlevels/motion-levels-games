import { createGame as createAnimations } from "@motion-levels-games/animations/game";
import { manifest as animationsManifest } from "@motion-levels-games/animations/manifest";
import { createGame as createArkanoid } from "@motion-levels-games/arkanoid/game";
import { manifest as arkanoidManifest } from "@motion-levels-games/arkanoid/manifest";
import { createGame as createCruceGalactico } from "@motion-levels-games/cruce-galactico/game";
import { manifest as cruceGalacticoManifest } from "@motion-levels-games/cruce-galactico/manifest";
import { createGame as createDuelo } from "@motion-levels-games/duelo/game";
import { manifest as dueloManifest } from "@motion-levels-games/duelo/manifest";
import { createGame as createEquilibrio } from "@motion-levels-games/equilibrio/game";
import { manifest as equilibrioManifest } from "@motion-levels-games/equilibrio/manifest";
import { createGame as createEstela } from "@motion-levels-games/estela/game";
import { manifest as estelaManifest } from "@motion-levels-games/estela/manifest";
import { createGame as createGuardianes } from "@motion-levels-games/guardianes/game";
import { manifest as guardianesManifest } from "@motion-levels-games/guardianes/manifest";
import { createGame as createHelloWorld } from "@motion-levels-games/hello-world/game";
import { manifest as helloWorldManifest } from "@motion-levels-games/hello-world/manifest";
import { createGame as createLava } from "@motion-levels-games/lava/game";
import { manifest as lavaManifest } from "@motion-levels-games/lava/manifest";
import { createGame as createMemoryChallenge } from "@motion-levels-games/memory-challenge/game";
import { manifest as memoryChallengeManifest } from "@motion-levels-games/memory-challenge/manifest";
import { createGame as createMemoriaV2 } from "@motion-levels-games/memoria-v2/game";
import { manifest as memoriaV2Manifest } from "@motion-levels-games/memoria-v2/manifest";
import { createGame as createMeteorDodge } from "@motion-levels-games/meteor-dodge/game";
import { manifest as meteorDodgeManifest } from "@motion-levels-games/meteor-dodge/manifest";
import { createGame as createParkour } from "@motion-levels-games/parkour/game";
import { manifest as parkourManifest } from "@motion-levels-games/parkour/manifest";
import { createGame as createPatrones } from "@motion-levels-games/patrones/game";
import { manifest as patronesManifest } from "@motion-levels-games/patrones/manifest";
import { createGame as createPingPong } from "@motion-levels-games/ping-pong/game";
import { manifest as pingPongManifest } from "@motion-levels-games/ping-pong/manifest";
import { createGame as createPingPongV2 } from "@motion-levels-games/ping-pong-v2/game";
import { manifest as pingPongV2Manifest } from "@motion-levels-games/ping-pong-v2/manifest";
import { createGame as createPulso } from "@motion-levels-games/pulso/game";
import { manifest as pulsoManifest } from "@motion-levels-games/pulso/manifest";
import { createGame as createSaltos } from "@motion-levels-games/saltos/game";
import { manifest as saltosManifest } from "@motion-levels-games/saltos/manifest";
import { createGame as createSueloSeguro } from "@motion-levels-games/suelo-seguro/game";
import { manifest as sueloSeguroManifest } from "@motion-levels-games/suelo-seguro/manifest";
import { createGame as createTemporada1Niveles } from "@motion-levels-games/temporada1-niveles/game";
import { manifest as temporada1NivelesManifest } from "@motion-levels-games/temporada1-niveles/manifest";
import { createGame as createTetris } from "@motion-levels-games/tetris/game";
import { manifest as tetrisManifest } from "@motion-levels-games/tetris/manifest";
import { createGame as createTiraSoga } from "@motion-levels-games/tira-soga/game";
import { manifest as tiraSogaManifest } from "@motion-levels-games/tira-soga/manifest";
import { createGame as createWhackAMole } from "@motion-levels-games/whack-a-mole/game";
import { manifest as whackAMoleManifest } from "@motion-levels-games/whack-a-mole/manifest";
import {
  gameManifestLookupKeys,
  gameManifestSlug,
  type GameConfig,
  type GameInstance,
  type GameManifest
} from "@motion-levels-games/game-sdk";

export type GameplayModule = {
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
};

const registeredGames: GameplayModule[] = [
  { manifest: animationsManifest, createGame: createAnimations },
  { manifest: arkanoidManifest, createGame: createArkanoid },
  { manifest: cruceGalacticoManifest, createGame: createCruceGalactico },
  { manifest: dueloManifest, createGame: createDuelo },
  { manifest: equilibrioManifest, createGame: createEquilibrio },
  { manifest: estelaManifest, createGame: createEstela },
  { manifest: guardianesManifest, createGame: createGuardianes },
  { manifest: helloWorldManifest, createGame: createHelloWorld },
  { manifest: lavaManifest, createGame: createLava },
  { manifest: memoryChallengeManifest, createGame: createMemoryChallenge },
  { manifest: memoriaV2Manifest, createGame: createMemoriaV2 },
  { manifest: meteorDodgeManifest, createGame: createMeteorDodge },
  { manifest: parkourManifest, createGame: createParkour },
  { manifest: patronesManifest, createGame: createPatrones },
  { manifest: pingPongManifest, createGame: createPingPong },
  { manifest: pingPongV2Manifest, createGame: createPingPongV2 },
  { manifest: pulsoManifest, createGame: createPulso },
  { manifest: saltosManifest, createGame: createSaltos },
  { manifest: sueloSeguroManifest, createGame: createSueloSeguro },
  { manifest: temporada1NivelesManifest, createGame: createTemporada1Niveles },
  { manifest: tetrisManifest, createGame: createTetris },
  { manifest: tiraSogaManifest, createGame: createTiraSoga },
  { manifest: whackAMoleManifest, createGame: createWhackAMole }
];

/** Canonical identities plus unique mutable aliases accepted by the venue API. */
export const gameplayRegistry = buildGameplayRegistry(registeredGames);

/** Exactly one gameplay module per package slug. */
export const gamePackageRegistry = new Map(
  registeredGames.map((game) => [gameManifestSlug(game.manifest), game] as const)
);

export const gameCatalog = registeredGames
  .map((game) => game.manifest)
  .sort((left, right) => left.id.localeCompare(right.id));

export function buildGameplayRegistry(games: readonly GameplayModule[]): Map<string, GameplayModule> {
  const registry = new Map<string, GameplayModule>();
  for (const game of games) {
    for (const key of gameManifestLookupKeys(game.manifest)) {
      const existing = registry.get(key);
      if (existing && existing !== game) {
        throw new Error(`game identity collision: ${key} is declared by ${existing.manifest.id} and ${game.manifest.id}`);
      }
      registry.set(key, game);
    }
  }
  return registry;
}
