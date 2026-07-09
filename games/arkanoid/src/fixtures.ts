import { createGame, type ArkanoidGameInstance } from "./game.ts";

const runningGame = createGame({ playerCount: 1, difficulty: "medium" });
export const initEvents = runningGame.init(0);
runningGame.press({ x: 7, y: 30, pressed: true, atMillis: 100 });
runningGame.tick({ atMillis: 1200 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const finishedGame = createGame({ playerCount: 1, difficulty: "easy" });
finishedGame.init(0);
autoplay(finishedGame);
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();

function autoplay(game: ArkanoidGameInstance): void {
  let nowMillis = 50;
  for (let step = 0; step < 24_000 && game.snapshot().phase !== "finished"; step += 1) {
    const snapshot = game.snapshot();
    game.press({ x: snapshot.ball.x, y: 30, pressed: true, atMillis: nowMillis });
    game.tick({ atMillis: nowMillis });
    nowMillis += 50;
  }
}
