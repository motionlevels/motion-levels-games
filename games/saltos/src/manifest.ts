import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "saltos",
  label: "Saltos",
  description: "Salta entre plataformas seguras sin tocar la lava durante un minuto.",
  availability: { development: true, production: true },
  catalog: {
    category: "individual",
    color: "#ff9f45",
    durationLabel: "60s",
    modeLabel: "Saltos",
    audioLabel: "Música + efectos",
    rules: ["Espera en la plataforma azul", "Salta a la plataforma verde", "No pises la lava"]
  },
  players: { allowAny: true, min: 1, max: 1 },
  start: { mode: "player-ready" },
  defaultDurationMillis: 60_000,
  config: { difficulty: { options: ["easy", "medium", "hard"], default: "medium" } },
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 0,
    actions: [{ atMillis: 100, type: "press", x: 8, y: 4 }],
    captureStartMillis: 2_300,
    frameCount: 24,
    frameIntervalMillis: 120
  },
  tags: ["saltos", "lava", "typescript"]
};
