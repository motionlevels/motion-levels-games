import * as animations from "@motion-levels-games/animations";
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
import * as pingPongV2 from "@motion-levels-games/ping-pong-v2";
import * as pulso from "@motion-levels-games/pulso";
import * as saltos from "@motion-levels-games/saltos";
import * as sueloSeguro from "@motion-levels-games/suelo-seguro";
import * as temporada1Niveles from "@motion-levels-games/temporada1-niveles";
import * as tetris from "@motion-levels-games/tetris";
import * as tiraSoga from "@motion-levels-games/tira-soga";
import * as whackAMole from "@motion-levels-games/whack-a-mole";
import { gameManifestLookupKeys, type GameManifest } from "@motion-levels-games/game-sdk";

export type DisplayModule = Readonly<{
  manifest: GameManifest;
  PlayerDisplay: unknown;
}>;

const displays = [
  animations, arkanoid, cruceGalactico, duelo, equilibrio, estela, guardianes, helloWorld, lava,
  memoryChallenge, memoriaV2, meteorDodge, parkour, patrones, pingPongV2, pulso, saltos,
  sueloSeguro, temporada1Niveles, tetris, tiraSoga, whackAMole
] satisfies DisplayModule[];

/** Browser-only registry. Node gameplay code must never import this module. */
export const displayRegistry = new Map<string, DisplayModule>();
for (const display of displays) {
  for (const key of gameManifestLookupKeys(display.manifest)) displayRegistry.set(key, display);
}
