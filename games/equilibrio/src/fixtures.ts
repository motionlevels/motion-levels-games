import { createGame, equilibrioChallenges, equilibrioDifficultyProfile, equilibrioRoundWinMillis } from "./game.ts";
import { manifest } from "./manifest.ts";

function startedGame() {
  const game = createGame({ playerCount: 0, durationMillis: manifest.defaultDurationMillis, difficulty: "medium" });
  game.init(0);
  game.press({ x: 4, y: 16, pressed: true, atMillis: 100 });
  game.press({ x: 11, y: 16, pressed: true, atMillis: 180 });
  game.tick({ atMillis: 2_180 });
  game.release({ x: 4, y: 16, pressed: false, atMillis: 2_200 });
  game.release({ x: 11, y: 16, pressed: false, atMillis: 2_210 });
  return game;
}

const runningGame = startedGame();
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const holdingGame = startedGame();
holdingGame.press({ x: 3, y: 6, pressed: true, atMillis: 2_300 });
holdingGame.press({ x: 12, y: 6, pressed: true, atMillis: 2_350 });
holdingGame.tick({ atMillis: 3_150 });
export const holdingFrame = holdingGame.render();
export const holdingSnapshot = holdingGame.snapshot();

const roundWinGame = startedGame();
roundWinGame.press({ x: 3, y: 6, pressed: true, atMillis: 2_300 });
roundWinGame.press({ x: 12, y: 6, pressed: true, atMillis: 2_350 });
roundWinGame.tick({ atMillis: 2_350 + equilibrioDifficultyProfile("medium").holdMillis });
export const roundWinFrame = roundWinGame.render();
export const roundWinSnapshot = roundWinGame.snapshot();

const finishedGame = startedGame();
let clock = 2_300;
for (const challenge of equilibrioChallenges) {
  const left = { x: challenge.left.minX, y: challenge.left.minY };
  const right = { x: challenge.right.minX, y: challenge.right.minY };
  finishedGame.press({ ...left, pressed: true, atMillis: clock });
  finishedGame.press({ ...right, pressed: true, atMillis: clock + 50 });
  clock += equilibrioDifficultyProfile("medium").holdMillis + 50;
  finishedGame.tick({ atMillis: clock });
  if (finishedGame.snapshot().phase === "round-win") {
    clock += equilibrioRoundWinMillis;
    finishedGame.tick({ atMillis: clock });
  }
  clock += 50;
}
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();
