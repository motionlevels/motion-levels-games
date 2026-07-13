import {
  createGame,
  gameWinAnimationMillis,
  onBlueTilePressed,
  onRedTilePressed,
  ropeLimit,
  roundWinAnimationMillis,
  type TiraSogaGameInstance
} from "./game.ts";

const waitingGame = createGame({ playerCount: 2, difficulty: "medium" });
export const initEvents = waitingGame.init(0);
export const waitingFrame = waitingGame.render();
export const waitingSnapshot = waitingGame.snapshot();

const startingGame = createGame({ playerCount: 2, difficulty: "hard" });
startingGame.init(0);
occupyReadyZones(startingGame, 100);
startingGame.tick({ atMillis: 1_100 });
export const startingFrame = startingGame.render();
export const startingSnapshot = startingGame.snapshot();

const runningGame = createGame({ playerCount: 2, difficulty: "medium" });
runningGame.init(0);
startGame(runningGame);
onRedTilePressed(runningGame, 3_200);
onRedTilePressed(runningGame, 3_300);
onBlueTilePressed(runningGame, 3_400);
onBlueTilePressed(runningGame, 3_500);
onBlueTilePressed(runningGame, 3_600);
onBlueTilePressed(runningGame, 3_700);
onBlueTilePressed(runningGame, 3_800);
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const roundWinGame = createGame({ playerCount: 2, difficulty: "easy" });
roundWinGame.init(0);
startGame(roundWinGame);
let roundWinTime = 3_200;
for (let index = 0; index < ropeLimit; index += 1) {
  onRedTilePressed(roundWinGame, roundWinTime);
  roundWinTime += 30;
}
roundWinGame.tick({ atMillis: roundWinTime + 500 });
export const roundWinFrame = roundWinGame.render();
export const roundWinSnapshot = roundWinGame.snapshot();

const finishedGame = createGame({ playerCount: 2, difficulty: "easy" });
finishedGame.init(0);
startGame(finishedGame);
let fixtureTime = 3_200;

function winFixtureRound(game: TiraSogaGameInstance, team: 0 | 1): void {
  for (let index = 0; index < ropeLimit; index += 1) {
    if (team === 0) {
      onRedTilePressed(game, fixtureTime);
    } else {
      onBlueTilePressed(game, fixtureTime);
    }
    fixtureTime += 30;
  }
  if (game.snapshot().phase !== "finished") {
    fixtureTime += roundWinAnimationMillis;
    game.tick({ atMillis: fixtureTime });
  }
}

for (const winner of [0, 1, 0, 1, 0] as const) {
  winFixtureRound(finishedGame, winner);
}
finishedGame.tick({ atMillis: fixtureTime + Math.floor(gameWinAnimationMillis / 3) });

export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();

function occupyReadyZones(game: TiraSogaGameInstance, atMillis: number): void {
  for (const zone of game.playerReadyZones()) {
    game.press({ x: zone.minX + 2, y: zone.minY + 2, pressed: true, atMillis });
  }
}

function startGame(game: TiraSogaGameInstance): void {
  occupyReadyZones(game, 100);
  game.tick({ atMillis: 3_100 });
  for (const zone of game.playerReadyZones()) {
    game.release({ x: zone.minX + 2, y: zone.minY + 2, pressed: false, atMillis: 3_101 });
  }
}
