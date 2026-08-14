import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "memoria-v2",
  label: "Memoria v2",
  description: "Memoriza y reconstruye figuras cada vez más complejas durante veinte niveles.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#22d3ee",
    durationLabel: "20 niveles",
    modeLabel: "Memoria progresiva",
    audioLabel: "Música + efectos",
    rules: ["Memoriza la figura azul", "Reconstrúyela cuando desaparezca", "Cada nivel permite tres errores"]
  },
  players: { allowAny: true, min: 1, max: 8 },
  start: { mode: "player-ready", releaseGraceMillis: 1_500 },
  defaultDurationMillis: 360_000,
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 0,
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 16 },
      { atMillis: 2_150, type: "release", x: 8, y: 16 },
      { atMillis: 7_250, type: "press", x: 5, y: 12 },
      { atMillis: 7_600, type: "press", x: 0, y: 14 },
      { atMillis: 7_950, type: "press", x: 2, y: 16 },
      { atMillis: 8_300, type: "press", x: 10, y: 22 }
    ],
    captureStartMillis: 6_500,
    frameCount: 24,
    frameIntervalMillis: 120
  },
  tags: ["memoria", "cooperativo", "typescript"]
};
