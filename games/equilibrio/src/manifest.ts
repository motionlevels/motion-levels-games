import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "equilibrio",
  label: "Equilibrio",
  description: "Coordina dos lados del suelo, ocupa las plataformas simétricas y mantén la balanza estable.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#5fff9e",
    durationLabel: "70s",
    modeLabel: "Cooperativo",
    audioLabel: "Efectos",
    rules: [
      "Entra en las dos zonas centrales para iniciar",
      "Ocupa a la vez las dos plataformas iluminadas",
      "Mantén el equilibrio hasta completar cada nivel",
      "Evita las baldosas oscuras para conservar la estabilidad"
    ]
  },
  players: {
    allowAny: true,
    min: 2,
    max: 8
  },
  start: { mode: "player-ready", countdownMillis: 2_000, releaseGraceMillis: 1_500 },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 70_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 4, y: 16 },
      { atMillis: 180, type: "press", x: 11, y: 16 },
      { atMillis: 2_250, type: "release", x: 4, y: 16 },
      { atMillis: 2_260, type: "release", x: 11, y: 16 },
      { atMillis: 2_400, type: "press", x: 3, y: 6 },
      { atMillis: 2_480, type: "press", x: 12, y: 6 }
    ],
    captureStartMillis: 2_650,
    frameCount: 24,
    frameIntervalMillis: 100
  },
  tags: ["equilibrio", "cooperativo", "coordinacion", "multijugador", "typescript"]
};
