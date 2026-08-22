import { createGame, type WhackAMoleGameInstance } from "./game.ts";

function create(stage: "waiting" | "starting" | "running" | "finished") {
  const game = createGame({ playerCount: 4, seed: 404, durationMillis: stage === "finished" ? 3_000 : 60_000 });
  game.init(0);
  if (stage !== "waiting") occupy(game);
  if (stage === "starting") game.tick({ atMillis: 1_600 });
  if (stage === "running" || stage === "finished") game.tick({ atMillis: 3_200 });
  if (stage === "finished") {
    const target = game.snapshot().targets[0]!;
    game.press({ x: target.x, y: target.y, pressed: true, atMillis: 3_300 });
    game.tick({ atMillis: 6_300 });
  }
  return game;
}
const waiting = create("waiting"); export const waitingFrame = waiting.render(); export const waitingSnapshot = waiting.snapshot();
const starting = create("starting"); export const startingFrame = starting.render(); export const startingSnapshot = starting.snapshot();
const running = create("running"); const target = running.snapshot().targets[1]!; running.press({ x: target.x, y: target.y, pressed: true, atMillis: 3_300 }); export const runningFrame = running.render(); export const runningSnapshot = running.snapshot();
const finished = create("finished"); export const finishedFrame = finished.render(); export const finishedSnapshot = finished.snapshot();
function occupy(game: WhackAMoleGameInstance) { game.playerReadyZones().forEach((zone) => game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 100 })); }
