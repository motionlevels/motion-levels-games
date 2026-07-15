import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "cruce-galactico",
  label: "Cruce Galáctico",
  description: "Cruza cuatro corredores cósmicos, esquiva el tráfico espacial y alcanza el portal de salida.",
  availability: { development: true, production: true },
  catalog: {
    category: "individual",
    color: "#7c5cff",
    durationLabel: "75 s",
    modeLabel: "Cruce espacial",
    audioLabel: "Música + efectos",
    rules: [
      "Empieza en la plataforma azul",
      "Cruza cada corredor evitando los obstáculos rojos",
      "Alcanza los cuatro controles antes de que termine el tiempo"
    ]
  },
  players: { allowAny: true, min: 1, max: 4 },
  start: { mode: "player-ready", releaseGraceMillis: 1_500 },
  config: { difficulty: { default: "medium", options: ["easy", "medium", "hard", "expert"] } },
  defaultDurationMillis: 75_000,
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 30 },
      { atMillis: 2_150, type: "release", x: 8, y: 30 },
      { atMillis: 2_500, type: "press", x: 8, y: 22 }
    ],
    captureStartMillis: 2_300,
    frameCount: 24,
    frameIntervalMillis: 120
  },
  tags: ["arcade", "crossing", "survival", "typescript"]
};
