import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "estela",
  label: "Estela",
  description: "Dibuja una estela de luz, evita todos los rastros y sé el último jugador en pie.",
  availability: { development: true, production: true },
  catalog: {
    category: "versus",
    color: "#d85cff",
    durationLabel: "Al mejor de 3",
    modeLabel: "Supervivencia de luz",
    audioLabel: "Música + efectos",
    rules: [
      "Cada jugador empieza en la plataforma de su color",
      "Muévete para extender tu estela sin tocar ningún rastro",
      "El último jugador en pie gana la ronda"
    ]
  },
  players: { allowAny: false, min: 2, max: 8 },
  start: { mode: "player-ready", countdownMillis: 3_000, releaseGraceMillis: 2_000 },
  config: { difficulty: { default: "medium", options: ["easy", "medium", "hard"] } },
  defaultDurationMillis: 0,
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 4,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 2, y: 2 },
      { atMillis: 100, type: "press", x: 13, y: 29 },
      { atMillis: 100, type: "press", x: 13, y: 2 },
      { atMillis: 100, type: "press", x: 2, y: 29 }
    ],
    captureStartMillis: 3_300,
    frameCount: 24,
    frameIntervalMillis: 120
  },
  tags: ["competitive", "multiplayer", "light-trails", "typescript"]
};
