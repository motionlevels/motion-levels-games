import { createGame } from "./game.ts";
import { testContent } from "./test-fixtures-content.ts";

const game = createGame({ playerCount: 1, difficulty: "medium", content: testContent });

export const initEvents = game.init(0);
game.tick({ atMillis: 1_500 });
export const countdownFrame = game.render();
export const countdownSnapshot = game.snapshot();

game.tick({ atMillis: 3_000 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();

game.press({ x: 7, y: 5, pressed: true, atMillis: 3_020 });
game.tick({ atMillis: 3_040 });
export const finishedFrame = game.render();
export const finishedSnapshot = game.snapshot();
