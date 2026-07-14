import { createGame, patternTargets } from "./game.ts";
import { manifest } from "./manifest.ts";

const game = createGame({ playerCount: 0, difficulty: "medium", durationMillis: manifest.defaultDurationMillis });
export const initEvents = game.init(0);
export const waitingSnapshot = game.snapshot();
game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
export const startingSnapshot = game.snapshot();
game.tick({ atMillis: 2_100 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();
patternTargets("medium").forEach((target, index) => game.press({ ...target, pressed: true, atMillis: 2_200 + index * 10 }));
export const finishedFrame = game.render();
export const finishedSnapshot = game.snapshot();
