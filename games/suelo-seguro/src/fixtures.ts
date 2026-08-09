import { createGame, sueloSeguroGameResultMillis, sueloSeguroRoundWinMillis, sueloSeguroStartingPlatforms, sueloSeguroTurnFailMillis } from "./game.ts";
import { manifest } from "./manifest.ts";

function startedGame() {
  const game = createGame({ playerCount: 4, durationMillis: manifest.defaultDurationMillis, difficulty: "medium", seed: 137 });
  game.init(0);
  sueloSeguroStartingPlatforms(4).forEach((platform, index) => {
    game.press({ x: platform.x, y: platform.y, pressed: true, atMillis: 100 + index * 80 });
  });
  game.tick({ atMillis: 2_400 });
  return game;
}

const runningGame = startedGame();
runningGame.tick({ atMillis: 2_700 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const roundWinGame = startedGame();
const firstTarget = roundWinGame.snapshot().targetPlatform!;
roundWinGame.press({ x: firstTarget.x, y: firstTarget.y, pressed: true, atMillis: 2_650 });
export const roundWinFrame = roundWinGame.render();
export const roundWinSnapshot = roundWinGame.snapshot();

const damagedGame = startedGame();
damagedGame.tick({ atMillis: 3_100 });
const danger = damagedGame.render().cells.find((cell) => cell.color === "#ff183d")!;
damagedGame.press({ x: danger.x, y: danger.y, pressed: true, atMillis: 3_100 });
export const damagedFrame = damagedGame.render();
export const damagedSnapshot = damagedGame.snapshot();

const failedGame = startedGame();
let failedClock = 2_400;
while (failedGame.snapshot().phase !== "finished") {
  failedClock += failedGame.snapshot().phase === "turn-fail"
    ? sueloSeguroTurnFailMillis
    : failedGame.snapshot().turnRemainingMillis;
  failedGame.tick({ atMillis: failedClock });
}
export const failedFrame = failedGame.render();
export const failedSnapshot = failedGame.snapshot();

const finishedGame = startedGame();
let clock = 2_650;
while (finishedGame.snapshot().phase !== "finished") {
  const target = finishedGame.snapshot().targetPlatform;
  if (!target) throw new Error("fixture expected an active target platform");
  finishedGame.press({ x: target.x, y: target.y, pressed: true, atMillis: clock });
  finishedGame.release({ x: target.x, y: target.y, pressed: false, atMillis: clock + 20 });
  if (finishedGame.snapshot().phase !== "finished") {
    clock += sueloSeguroRoundWinMillis + 40;
    finishedGame.tick({ atMillis: clock });
    clock += 40;
  }
}
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();

const resetGame = startedGame();
resetGame.tick({ atMillis: manifest.defaultDurationMillis + 2_400 });
resetGame.tick({ atMillis: manifest.defaultDurationMillis + 2_400 + sueloSeguroGameResultMillis });
export const resetSnapshot = resetGame.snapshot();
