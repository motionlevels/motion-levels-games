import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "lava", label: "El suelo es lava",
  description: "Moveos en equipo, evitad la lava y conquistad plataformas seguras durante un minuto.",
  availability: { development: true, production: true },
  catalog: { category: "team", color: "#ff5268", durationLabel: "60s", modeLabel: "Plataformas", audioLabel: "Música + efectos", rules: ["Espera en la zona azul", "Pisa las plataformas verdes", "Evita la lava roja durante un minuto"] },
  players: { allowAny: true, min: 1, max: 6 }, start: { mode: "player-ready", releaseGraceMillis: 1_500 },
  defaultDurationMillis: 60_000,
  config: { difficulty: { options: ["easy", "medium", "hard", "expert"], default: "medium" } },
  display: { entry: "./display" },
  preview: { seed: 137, playerCount: 0, difficulty: "medium", actions: [{ atMillis: 100, type: "press", x: 8, y: 16 }], captureStartMillis: 4_000, frameCount: 24, frameIntervalMillis: 120 },
  tags: ["lava", "cooperativo", "typescript"]
};
