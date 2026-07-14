import { createGame } from "./game.ts";

const game = createGame({ playerCount: 0, seed: 137 });
export const initEvents = game.init(0);
export const waitingSnapshot = game.snapshot();
game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
export const startingSnapshot = game.snapshot();
game.tick({ atMillis: 2_100 });
export const memorizeFrame = game.render();
export const memorizeSnapshot = game.snapshot();
game.tick({ atMillis: 7_100 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();
for (const target of game.snapshot().targets) game.press({ ...target, pressed: true, atMillis: 7_200 });
export const roundWinFrame = game.render();
export const roundWinSnapshot = game.snapshot();
