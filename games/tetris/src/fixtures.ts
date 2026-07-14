import { createGame } from "./game.ts";
function gameAt(stage: "waiting" | "starting" | "running") { const game = createGame({ playerCount: 1, seed: 137 }); game.init(0); if (stage !== "waiting") game.press({ x: 8, y: 29, pressed: true, atMillis: 100 }); if (stage === "running") game.tick({ atMillis: 2_200 }); return game; }
const waiting = gameAt("waiting"); export const waitingFrame = waiting.render(); export const waitingSnapshot = waiting.snapshot();
const starting = gameAt("starting"); export const startingFrame = starting.render(); export const startingSnapshot = starting.snapshot();
const running = gameAt("running"); running.press({ x: 5, y: 31, pressed: true, atMillis: 2_300 }); export const runningFrame = running.render(); export const runningSnapshot = running.snapshot();
