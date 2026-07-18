import { createGame, guardianLanes, guardianesThreatChart } from "./game.ts";
import { manifest } from "./manifest.ts";

function startedGame() {
  const game = createGame({ playerCount: 0, durationMillis: manifest.defaultDurationMillis, difficulty: "medium" });
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  game.release({ x: 8, y: 16, pressed: false, atMillis: 2_120 });
  return game;
}

const runningGame = startedGame();
runningGame.tick({ atMillis: 4_500 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const defendedGame = startedGame();
const firstThreat = guardianesThreatChart()[0]!;
const firstLane = guardianLanes[firstThreat.lane]!;
defendedGame.press({ x: firstLane.shieldX, y: 28, pressed: true, atMillis: 2_500 });
defendedGame.tick({ atMillis: 2_100 + firstThreat.impactMillis });
export const defendedFrame = defendedGame.render();
export const defendedSnapshot = defendedGame.snapshot();

const damagedGame = startedGame();
for (const threat of guardianesThreatChart().slice(0, 2)) damagedGame.tick({ atMillis: 2_100 + threat.impactMillis });
export const damagedFrame = damagedGame.render();
export const damagedSnapshot = damagedGame.snapshot();

const failedGame = startedGame();
for (const threat of guardianesThreatChart().slice(0, 4)) failedGame.tick({ atMillis: 2_100 + threat.impactMillis });
export const failedFrame = failedGame.render();
export const failedSnapshot = failedGame.snapshot();

const finishedGame = startedGame();
for (const threat of guardianesThreatChart()) {
  const lane = guardianLanes[threat.lane]!;
  finishedGame.press({ x: lane.shieldX, y: 28, pressed: true, atMillis: 2_100 + threat.impactMillis - 100 });
  finishedGame.tick({ atMillis: 2_100 + threat.impactMillis });
  finishedGame.release({ x: lane.shieldX, y: 28, pressed: false, atMillis: 2_100 + threat.impactMillis + 10 });
}
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();
