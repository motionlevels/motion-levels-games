import { createGame } from "./game.ts";
const game = createGame({ playerCount: 0, seed: 137, difficulty: "medium" });
export const initEvents = game.init(0); export const waitingSnapshot = game.snapshot();
game.press({ x: 8, y: 16, pressed: true, atMillis: 100 }); export const startingSnapshot = game.snapshot();
game.tick({ atMillis: 2_100 }); game.tick({ atMillis: 4_000 }); export const runningFrame = game.render(); export const runningSnapshot = game.snapshot();
game.press({ x: 0, y: 31, pressed: true, atMillis: 4_100 }); export const damagedFrame = game.render(); export const damagedSnapshot = game.snapshot();
