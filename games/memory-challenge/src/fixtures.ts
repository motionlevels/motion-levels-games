import type { GameConfigPlayer } from "@motion-levels-games/game-sdk";
import { createGame, type MemoryChallengeGameInstance } from "./game.ts";

const players: GameConfigPlayer[] = [
  { name: "Verde", color: "#42e879" },
  { name: "Cian", color: "#24d9ff" }
];

function gameAt(stage: "waiting" | "starting" | "memorize" | "recall") {
  const game = createGame({ playerCount: 2, players, seed: 137 });
  game.init(0);
  if (stage !== "waiting") occupy(game, 100);
  if (stage === "memorize" || stage === "recall") game.tick({ atMillis: 2_200 });
  if (stage === "recall") game.tick({ atMillis: 5_100 });
  return game;
}

const waiting = gameAt("waiting");
export const waitingFrame = waiting.render();
export const waitingSnapshot = waiting.snapshot();
const starting = gameAt("starting");
export const startingFrame = starting.render();
export const startingSnapshot = starting.snapshot();
const memorizing = gameAt("memorize");
export const memorizingFrame = memorizing.render();
export const memorizingSnapshot = memorizing.snapshot();
const recalling = gameAt("recall");
playSteps(recalling, 0, 7, 5_200);
export const recallingFrame = recalling.render();
export const recallingSnapshot = recalling.snapshot();
const failed = gameAt("recall");
failed.press({ x: 7, y: 31, pressed: true, atMillis: 5_200 });
export const failedFrame = failed.render();
export const failedSnapshot = failed.snapshot();
const finished = gameAt("recall");
playSteps(finished, 0, Number.POSITIVE_INFINITY, 5_200);
export const finishedFrame = finished.render();
export const finishedSnapshot = finished.snapshot();

function occupy(game: MemoryChallengeGameInstance, atMillis: number) {
  for (const zone of game.playerReadyZones()) game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis });
}

function playSteps(game: MemoryChallengeGameInstance, player: number, count: number, atMillis: number) {
  game.pathForPlayer(player).slice(0, count).forEach((point, index) => game.press({ ...point, pressed: true, atMillis: atMillis + index }));
}
