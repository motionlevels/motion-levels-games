import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "arkanoid",
  label: "Arkanoid",
  description: "Single-player floor Arkanoid with step-controlled paddle movement and deterministic brick physics.",
  availability: { development: true, production: true },
  catalog: {
    category: "individual",
    color: "#ff9f45",
    durationLabel: "Sin límite",
    modeLabel: "Arkanoid",
    audioLabel: "Efectos",
    rules: ["Pisa la zona inferior para mover la pala", "Rompe todos los bloques sin perder la pelota"]
  },
  players: {
    allowAny: true,
    min: 1,
    max: 1
  },
  start: { mode: "player-ready" },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 1,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 7, y: 30 },
      { atMillis: 2_150, type: "release", x: 7, y: 30 },
      { atMillis: 2_250, type: "press", x: 9, y: 30 },
      { atMillis: 2_450, type: "release", x: 9, y: 30 }
    ],
    captureStartMillis: 2_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["arcade", "single-player", "typescript"]
};
