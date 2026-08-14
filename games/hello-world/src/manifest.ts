import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "hello-world",
  label: "Hola Mundo",
  description: "Sigue los objetivos verdes y evita las baldosas rojas.",
  availability: { development: true, production: false },
  catalog: {
    category: "individual",
    color: "#35d7ff",
    durationLabel: "30s",
    modeLabel: "Demostración",
    audioLabel: "Efectos",
    rules: ["Sigue los objetivos verdes", "Evita las baldosas rojas"]
  },
  players: {
    allowAny: true,
    min: 1,
    max: 1
  },
  start: { mode: "player-ready" },
  defaultDurationMillis: 30_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 2_024,
    playerCount: 1,
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 16 },
      { atMillis: 2_150, type: "release", x: 8, y: 16 },
      { atMillis: 2_300, type: "press", x: 3, y: 5 },
      { atMillis: 2_700, type: "press", x: 12, y: 5 },
      { atMillis: 3_100, type: "press", x: 8, y: 16 },
      { atMillis: 3_500, type: "press", x: 3, y: 26 },
      { atMillis: 3_900, type: "press", x: 12, y: 26 }
    ],
    captureStartMillis: 2_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["example", "ci", "typescript"]
};
