import type { Frame } from "@motion-levels-games/game-sdk";
import { createGame, type AnimationSnapshot } from "./game.ts";

const game = createGame({ seed: 137, playerCount: 0, options: { animation: "neon-ribbons", mode: "single", speed: 1, rotationSeconds: 20 } });
game.init(0);
game.tick({ atMillis: 2_400 });

export const runningFrame: Frame = game.render();
export const runningSnapshot: AnimationSnapshot = game.snapshot();
