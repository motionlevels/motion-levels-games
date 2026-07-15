import { createGame, type GalacticCrossingGameInstance } from "./game.ts";

const runningGame = createGame({ playerCount: 1, difficulty: "medium", seed: 137 });
export const initEvents = runningGame.init(0);
start(runningGame);
runningGame.release({ x: 8, y: 30, pressed: false, atMillis: 2_150 });
runningGame.tick({ atMillis: 3_000 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const damagedGame = createGame({ playerCount: 1, difficulty: "medium", seed: 137 });
damagedGame.init(0);
start(damagedGame);
damagedGame.release({ x: 8, y: 30, pressed: false, atMillis: 2_150 });
damagedGame.tick({ atMillis: 3_000 });
const hazard = damagedGame.snapshot().hazards[0]!;
damagedGame.press({ x: Math.max(0, hazard.x), y: hazard.y, pressed: true, atMillis: 3_001 });
damagedGame.tick({ atMillis: 3_002 });
export const damagedSnapshot = damagedGame.snapshot();

const finishedGame = createGame({ playerCount: 1, difficulty: "medium", seed: 137 });
finishedGame.init(0);
start(finishedGame);
for (const y of [22, 15, 8, 1]) finishedGame.press({ x: 8, y, pressed: true, atMillis: 2_200 + (22 - y) * 10 });
finishedGame.tick({ atMillis: 3_100 });
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();

function start(game: GalacticCrossingGameInstance): void {
  game.press({ x: 8, y: 30, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
}
