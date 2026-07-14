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
    actions: [{ atMillis: 100, type: "press", x: 8, y: 16 }],
    captureStartMillis: 2_300,
    frameCount: 24,
    frameIntervalMillis: 120
  },
  tags: ["patrones", "memoria", "typescript"]
};
