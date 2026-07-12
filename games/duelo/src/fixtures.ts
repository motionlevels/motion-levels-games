import type { GameConfigPlayer } from "@motion-levels-games/game-sdk";
import { createGame, type DueloGameInstance } from "./game.ts";

const twoPlayerRoster: GameConfigPlayer[] = [
  { name: "Rojo", color: "#ff3048" },
  { name: "Cian", color: "#24d9ff" }
];

const waitingGame = createGame({ playerCount: 2, players: twoPlayerRoster, seed: 137, difficulty: "medium" });
waitingGame.init(0);
export const waitingFrame = waitingGame.render();
export const waitingSnapshot = waitingGame.snapshot();

const startingGame = createGame({ playerCount: 2, players: twoPlayerRoster, seed: 137, difficulty: "hard" });
startingGame.init(0);
occupyReadyZones(startingGame, 100);
startingGame.tick({ atMillis: 1_100 });
export const startingFrame = startingGame.render();
export const startingSnapshot = startingGame.snapshot();

const runningGame = createGame({ playerCount: 2, players: twoPlayerRoster, seed: 137, difficulty: "hard" });
runningGame.init(0);
startGame(runningGame);
claimTargets(runningGame, 0, 8, 3_200);
claimTargets(runningGame, 1, 5, 3_400);
runningGame.tick({ atMillis: 18_700 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const crowdedRoster: GameConfigPlayer[] = [
  { name: "Alejandra del Equipo Relámpago", color: "#ff3048" },
  { name: "Bruno", color: "#24d9ff" },
  { name: "Carolina", color: "#42e879" },
  { name: "Diego", color: "#ff4fd8" },
  { name: "Elena", color: "#376bff" },
  { name: "Fernando", color: "#ffd84d" },
  { name: "Gabriela", color: "#a66cff" },
  { name: "Hugo", color: "#ff8a3d" }
];
const crowdedGame = createGame({ playerCount: 8, players: crowdedRoster, seed: 2026, difficulty: "medium" });
crowdedGame.init(0);
startGame(crowdedGame);
for (let player = 0; player < 8; player += 1) {
  claimTargets(crowdedGame, player, player + 1, 3_200 + player * 50);
}
crowdedGame.tick({ atMillis: 48_230 });
export const crowdedRunningFrame = crowdedGame.render();
export const crowdedRunningSnapshot = crowdedGame.snapshot();

const finishedGame = createGame({
  playerCount: 2,
  players: twoPlayerRoster,
  seed: 137,
  difficulty: "medium",
  options: { base_fill_percent: 30 }
});
finishedGame.init(0);
startGame(finishedGame);
claimTargets(finishedGame, 1, Number.POSITIVE_INFINITY, 3_200);
finishedGame.tick({ atMillis: 4_200 });
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();

function occupyReadyZones(game: DueloGameInstance, atMillis: number): void {
  game.playerReadyZones().forEach((zone) => {
    game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis });
  });
}

function startGame(game: DueloGameInstance): void {
  occupyReadyZones(game, 100);
  game.tick({ atMillis: 3_100 });
}

function claimTargets(game: DueloGameInstance, owner: number, limit: number, atMillis: number): void {
  let claimed = 0;
  for (let y = 0; y < 32 && claimed < limit; y += 1) {
    for (let x = 0; x < 16 && claimed < limit; x += 1) {
      if (game.targetOwner(x, y) !== owner) continue;
      game.press({ x, y, pressed: true, atMillis: atMillis + claimed });
      claimed += 1;
    }
  }
}
