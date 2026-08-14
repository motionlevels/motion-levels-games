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
      { atMillis: 100, type: "press", x: 11, y: 24 },
      { atMillis: 3_300, type: "press", x: 2, y: 4 },
      { atMillis: 3_320, type: "release", x: 2, y: 4 },
      { atMillis: 3_520, type: "press", x: 5, y: 10 },
      { atMillis: 3_540, type: "release", x: 5, y: 10 },
      { atMillis: 3_900, type: "press", x: 9, y: 21 },
      { atMillis: 3_920, type: "release", x: 9, y: 21 },
      { atMillis: 4_120, type: "press", x: 13, y: 27 },
      { atMillis: 4_140, type: "release", x: 13, y: 27 },
      { atMillis: 4_500, type: "press", x: 3, y: 12 },
      { atMillis: 4_520, type: "release", x: 3, y: 12 },
      { atMillis: 4_720, type: "press", x: 12, y: 6 },
      { atMillis: 4_740, type: "release", x: 12, y: 6 }
    ],
    captureStartMillis: 3_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["competitive", "teams", "two-player", "typescript"]
};
