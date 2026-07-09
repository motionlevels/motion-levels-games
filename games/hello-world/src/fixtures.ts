import { createGame } from "./game.ts";

const game = createGame({
  seed: 2_024,
  playerCount: 1,
  durationMillis: 30_000
});

export const initEvents = game.init(0);
game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
game.tick({ atMillis: 2_100 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();

game.press({ x: 3, y: 5, pressed: true, atMillis: 2_200 });
game.press({ x: 12, y: 5, pressed: true, atMillis: 2_300 });
game.press({ x: 8, y: 16, pressed: true, atMillis: 2_400 });
game.press({ x: 3, y: 26, pressed: true, atMillis: 2_500 });
game.press({ x: 12, y: 26, pressed: true, atMillis: 2_600 });

export const finishedFrame = game.render();
export const finishedSnapshot = game.snapshot();
