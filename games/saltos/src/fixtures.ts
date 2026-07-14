import { createGame } from "./game.ts";
import { manifest } from "./manifest.ts";

const game = createGame({ playerCount: 0, durationMillis: manifest.defaultDurationMillis, seed: 137 });
export const initEvents = game.init(0);
export const waitingFrame = game.render();
export const waitingSnapshot = game.snapshot();
game.press({ x: 8, y: 4, pressed: true, atMillis: 100 });
export const startingSnapshot = game.snapshot();
game.tick({ atMillis: 2_100 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();
const target = game.snapshot().targetPlatform;
if (target) game.press({ ...target, pressed: true, atMillis: 2_200 });
game.tick({ atMillis: 62_100 });
export const finishedFrame = game.render();
export const finishedSnapshot = game.snapshot();
