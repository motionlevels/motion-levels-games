import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "tira-soga",
  label: "Tira-Soga",
  description: "Five-round team tug of war driven by rapid presses on the red and blue floor halves.",
  availability: { development: true, production: false },
  catalog: {
    category: "versus",
    color: "#ff9f1c",
    durationLabel: "Sin límite",
    modeLabel: "Tira y afloja",
    audioLabel: "Efectos",
    rules: [
      "Rojo ocupa la mitad superior y azul la inferior",
      "Pisa rápidamente tu campo para arrastrar la soga",
      "Gana tres de las cinco rondas"
    ]
  },
  players: {
    allowAny: true,
    min: 2,
    max: 2
  },
  start: {
    mode: "player-ready",
    countdownMillis: 3_000,
    releaseGraceMillis: 2_000
  },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard"]
    }
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 2,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 4, y: 8 },
      { atMillis: 100, type: "press", x: 11, y: 24 }
    ],
    captureStartMillis: 3_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["competitive", "teams", "two-player", "typescript"]
};
