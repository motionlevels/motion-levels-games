import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "suelo-seguro",
  label: "Suelo Seguro",
  description: "Cada jugador protege una plataforma de 2×2, se desplaza por turnos y esquiva un patrón rojo en movimiento.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#5fff9e",
    durationLabel: "90s",
    modeLabel: "Cooperativo por turnos",
    audioLabel: "Efectos",
    rules: [
      "Cada jugador empieza sobre su plataforma de 2×2",
      "Cuando desaparezca tu plataforma, busca la nueva de tu color",
      "Muévete antes de que termine el turno",
      "No pises el patrón rojo en movimiento"
    ]
  },
  players: {
    allowAny: false,
    min: 1,
    max: 8
  },
  start: { mode: "player-ready", countdownMillis: 2_000, releaseGraceMillis: 1_500 },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 90_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 4,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 1, y: 1 },
      { atMillis: 180, type: "press", x: 13, y: 1 },
      { atMillis: 260, type: "press", x: 13, y: 29 },
      { atMillis: 340, type: "press", x: 1, y: 29 },
      { atMillis: 2_450, type: "release", x: 1, y: 1 },
      { atMillis: 2_500, type: "press", x: 5, y: 19 }
    ],
    captureStartMillis: 2_700,
    frameCount: 30,
    frameIntervalMillis: 100
  },
  tags: ["plataformas", "cooperativo", "turnos", "reflejos", "multijugador", "typescript"]
};
