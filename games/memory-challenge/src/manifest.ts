import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "memory-challenge",
  label: "Reto de memoria",
  description: "Memoriza un camino oculto en tu calle y recórrelo antes que los demás sin pisar la lava.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#005af8",
    durationLabel: "90 s",
    modeLabel: "Camino oculto",
    audioLabel: "Música + efectos",
    rules: [
      "Cada jugador ocupa la salida de su calle",
      "Memoriza el camino iluminado antes de que desaparezca",
      "Si pisas la lava, vuelve a tu salida para intentarlo otra vez"
    ]
  },
  players: { allowAny: false, min: 1, max: 4 },
  start: { mode: "player-ready", releaseGraceMillis: 1_200 },
  defaultDurationMillis: 90_000,
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 2,
    actions: [
      { atMillis: 100, type: "press", x: 3, y: 0 },
      { atMillis: 100, type: "press", x: 11, y: 0 }
    ],
    captureStartMillis: 2_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["memory", "race", "multiplayer", "typescript"]
};
