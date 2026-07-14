import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "whack-a-mole",
  label: "Atrapa al topo",
  description: "Persigue objetivos de colores por todo el suelo y atrápalos antes de que se apaguen.",
  availability: { development: true, production: true },
  catalog: {
    category: "versus", color: "#36d9ff", durationLabel: "60 s",
    modeLabel: "Todos contra todos", audioLabel: "Música + efectos",
    rules: ["Cada jugador ocupa su plataforma de salida", "Pisa los objetivos de tu color antes de que desaparezcan", "Cuanto más rápido llegues, más puntos ganas"]
  },
  players: { allowAny: false, min: 1, max: 8 },
  start: { mode: "player-ready", releaseGraceMillis: 1_200 },
  config: { difficulty: { default: "medium", options: ["easy", "medium"] } },
  defaultDurationMillis: 60_000,
  display: { entry: "./display" },
  preview: {
    seed: 404, playerCount: 4, difficulty: "medium",
    actions: [{ atMillis: 100, type: "press", x: 0, y: 0 }, { atMillis: 100, type: "press", x: 12, y: 28 }, { atMillis: 100, type: "press", x: 0, y: 28 }, { atMillis: 100, type: "press", x: 12, y: 0 }],
    captureStartMillis: 2_300, frameCount: 18, frameIntervalMillis: 120
  },
  tags: ["arcade", "reaction", "multiplayer", "typescript"]
};
