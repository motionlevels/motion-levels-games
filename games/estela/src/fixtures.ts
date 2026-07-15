import { createGame, roundWinAnimationMillis, type EstelaGameInstance } from "./game.ts";

const runningGame = createGame({ playerCount: 4, difficulty: "medium" });
export const initEvents = runningGame.init(0);
start(runningGame);
runningGame.press({ x: 3, y: 2, pressed: true, atMillis: 3_200 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const roundWinGame = createGame({ playerCount: 2 });
roundWinGame.init(0);
start(roundWinGame);
eliminateFirst(roundWinGame, 3_200);
export const roundWinFrame = roundWinGame.render();
export const roundWinSnapshot = roundWinGame.snapshot();

roundWinGame.tick({ atMillis: 3_201 + roundWinAnimationMillis });
eliminateFirst(roundWinGame, 5_200);
roundWinGame.tick({ atMillis: 5_201 + roundWinAnimationMillis });
roundWinGame.tick({ atMillis: 7_500 });
export const finishedFrame = roundWinGame.render();
export const finishedSnapshot = roundWinGame.snapshot();

function start(game: EstelaGameInstance): void {
  game.snapshot().startPositions.forEach((position) => game.press({ ...position, pressed: true, atMillis: 100 }));
  game.tick({ atMillis: 3_100 });
}
function eliminateFirst(game: EstelaGameInstance, atMillis: number): void {
  game.press({ x: 3, y: 2, pressed: true, atMillis });
  game.press({ x: 2, y: 2, pressed: true, atMillis: atMillis + 1 });
}
