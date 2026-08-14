import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "patrones",
  label: "Patrones",
  description: "Reconstruye patrones azules sin pisar baldosas incorrectas.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#176bff",
    durationLabel: "45s",
    modeLabel: "Reconstrucción",
    audioLabel: "Música + efectos",
    rules: ["Memoriza el patrón azul", "Pisa cada objetivo una vez", "Evita las demás baldosas"]
  },
  players: { allowAny: true, min: 1, max: 1 },
  start: { mode: "player-ready" },
  defaultDurationMillis: 45_000,
  config: { difficulty: { options: ["easy", "medium", "hard"], default: "medium" } },
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 16 },
      { atMillis: 2_400, type: "press", x: 7, y: 8 },
      { atMillis: 2_760, type: "press", x: 8, y: 8 },
      { atMillis: 3_120, type: "press", x: 6, y: 10 },
      { atMillis: 3_480, type: "press", x: 9, y: 10 },
      { atMillis: 3_840, type: "press", x: 5, y: 12 },
      { atMillis: 4_200, type: "press", x: 10, y: 12 }
    ],
    captureStartMillis: 2_300,
    frameCount: 24,
    frameIntervalMillis: 120
  },
  tags: ["patrones", "memoria", "typescript"]
};
