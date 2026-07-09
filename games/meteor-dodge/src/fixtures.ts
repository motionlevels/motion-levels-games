import { createGame, type MeteorDodgeGameInstance } from "./game.ts";

const runningGame = createGame({ playerCount: 1, difficulty: "medium", seed: 137 });
export const initEvents = runningGame.init(0);
startGame(runningGame);
runningGame.release({ x: 8, y: 16, pressed: false, atMillis: 2_150 });
runningGame.tick({ atMillis: 4_000 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const damagedGame = createGame({ playerCount: 1, difficulty: "easy", seed: 137 });
damagedGame.init(0);
startGame(damagedGame);
damageOnce(damagedGame, 2_450);
export const damagedFrame = damagedGame.render();
export const damagedSnapshot = damagedGame.snapshot();

const finishedGame = createGame({ playerCount: 1, difficulty: "medium", durationMillis: 4_000, seed: 137 });
finishedGame.init(0);
startGame(finishedGame);
finishedGame.release({ x: 8, y: 16, pressed: false, atMillis: 2_150 });
finishedGame.tick({ atMillis: 6_100 });
finishedGame.tick({ atMillis: 7_000 });
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();

const failedGame = createGame({ playerCount: 1, difficulty: "easy", seed: 137 });
failedGame.init(0);
startGame(failedGame);
let failureClock = 2_450;
for (let hit = 0; hit < 3; hit += 1) {
  failureClock = damageOnce(failedGame, failureClock) + 1_050;
}
export const failedFrame = failedGame.render();
export const failedSnapshot = failedGame.snapshot();

function startGame(game: MeteorDodgeGameInstance): void {
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
}

function damageOnce(game: MeteorDodgeGameInstance, nowMillis: number): number {
  game.release({ x: 8, y: 16, pressed: false, atMillis: nowMillis });
  game.tick({ atMillis: nowMillis });
  const meteor = game.snapshot().meteors.find((candidate) => candidate.result === "pending");
  if (!meteor) {
    return nowMillis;
  }
  game.press({ x: meteor.x, y: meteor.y, pressed: true, atMillis: meteor.impactAtMillis - 1 });
  game.tick({ atMillis: meteor.impactAtMillis });
  game.release({ x: meteor.x, y: meteor.y, pressed: false, atMillis: meteor.impactAtMillis + 1 });
  return meteor.impactAtMillis + 1;
}
