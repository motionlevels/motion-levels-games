import { createGame, helloWorldHazards, helloWorldTargets, type HelloWorldGameInstance } from "./game.ts";

export const waitingGame = createGame({ seed: 2_024, playerCount: 1, durationMillis: 30_000 });
export const initEvents = waitingGame.init(0);
export const waitingFrame = waitingGame.render();
export const waitingSnapshot = waitingGame.snapshot();

const startingGame = createGame({ seed: 2_024, playerCount: 1, durationMillis: 30_000 });
startingGame.init(0);
startingGame.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
startingGame.tick({ atMillis: 1_100 });
export const startingFrame = startingGame.render();
export const startingSnapshot = startingGame.snapshot();

const runningGame = createStartedGame();
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const damagedGame = createStartedGame();
damagedGame.press({ ...helloWorldHazards()[0], pressed: true, atMillis: 2_200 });
export const damagedFrame = damagedGame.render();
export const damagedSnapshot = damagedGame.snapshot();

const winningGame = createStartedGame();
helloWorldTargets().forEach((target, index) => {
  winningGame.press({ ...target, pressed: true, atMillis: 2_200 + index * 100 });
});
winningGame.tick({ atMillis: 4_100 });
export const winningFrame = winningGame.render();
export const winningSnapshot = winningGame.snapshot();

const losingGame = createStartedGame();
helloWorldHazards().forEach((hazard, index) => {
  losingGame.press({ ...hazard, pressed: true, atMillis: 2_200 + index * 100 });
});
losingGame.tick({ atMillis: 4_100 });
export const losingFrame = losingGame.render();
export const losingSnapshot = losingGame.snapshot();

function createStartedGame(): HelloWorldGameInstance {
  const game = createGame({ seed: 2_024, playerCount: 1, durationMillis: 30_000 });
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  return game;
}
