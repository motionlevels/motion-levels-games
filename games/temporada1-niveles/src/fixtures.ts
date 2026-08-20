import { createGame } from "./game.ts";
import { testContent } from "./test-fixtures-content.ts";

const game = createGame({ playerCount: 4, difficulty: "medium", content: testContent });

export const initEvents = game.init(0);
game.tick({ atMillis: 1_500 });
export const countdownFrame = game.render();
export const countdownSnapshot = game.snapshot();

game.tick({ atMillis: 3_000 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();

game.press({ x: 2, y: 5, pressed: true, atMillis: 3_020 });
game.press({ x: 13, y: 24, pressed: true, atMillis: 3_040 });
game.press({ x: 8, y: 14, pressed: true, atMillis: 3_060 });
game.release({ x: 8, y: 14, pressed: false, atMillis: 3_080 });
game.press({ x: 8, y: 14, pressed: true, atMillis: 3_100 });
game.tick({ atMillis: 3_120 });
export const finishedFrame = game.render();
export const finishedSnapshot = game.snapshot();
