import { createGame, pulseChart, pulseDifficultyProfile, pulsePads } from "./game.ts";
import { manifest } from "./manifest.ts";

function startedGame() {
  const game = createGame({ playerCount: 0, durationMillis: manifest.defaultDurationMillis, difficulty: "medium" });
  game.init(0);
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  game.tick({ atMillis: 2_100 });
  return game;
}

const runningGame = startedGame();
runningGame.tick({ atMillis: 2_100 + 1_200 });
export const runningFrame = runningGame.render();
export const runningSnapshot = runningGame.snapshot();

const comboGame = startedGame();
const comboChart = pulseChart();
for (const note of comboChart.slice(0, 7)) {
  for (const zone of note.zones) {
    const pad = pulsePads[zone]!;
    comboGame.press({ x: pad.x, y: pad.y, pressed: true, atMillis: 2_100 + note.atMillis });
  }
  if (note.holdMillis > 0) {
    comboGame.tick({ atMillis: 2_100 + note.atMillis + note.holdMillis });
  }
}
export const comboFrame = comboGame.render();
export const comboSnapshot = comboGame.snapshot();

const failedGame = startedGame();
const profile = pulseDifficultyProfile("medium");
for (const note of pulseChart().slice(0, 6)) {
  failedGame.tick({ atMillis: 2_100 + note.atMillis + profile.timingWindowMillis + 1 });
}
export const failedFrame = failedGame.render();
export const failedSnapshot = failedGame.snapshot();

const finishedGame = startedGame();
for (const note of pulseChart()) {
  for (const zone of note.zones) {
    const pad = pulsePads[zone]!;
    finishedGame.press({ x: pad.x, y: pad.y, pressed: true, atMillis: 2_100 + note.atMillis });
  }
  if (note.holdMillis > 0) {
    finishedGame.tick({ atMillis: 2_100 + note.atMillis + note.holdMillis });
  }
}
export const finishedFrame = finishedGame.render();
export const finishedSnapshot = finishedGame.snapshot();
