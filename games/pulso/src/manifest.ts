import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "pulso",
  label: "Pulso",
  description: "Ritmo cooperativo: pisa cada pulso a tiempo y mantén la energía de la pista.",
  availability: { development: true, production: true },
  catalog: {
    category: "arcade",
    color: "#ff3bd7",
    durationLabel: "35s",
    modeLabel: "Ritmo cooperativo",
    audioLabel: "Música y efectos",
    rules: [
      "Pisa la zona cuando el pulso llegue al centro",
      "Completa los acordes entre varios jugadores",
      "Mantén las notas largas hasta que terminen",
      "No dejes que la energía llegue a cero"
    ]
  },
  players: {
    allowAny: true,
    min: 1,
    max: 8
  },
  start: { mode: "player-ready", countdownMillis: 2_000, releaseGraceMillis: 1_200 },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 35_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 16 },
      { atMillis: 2_150, type: "release", x: 8, y: 16 }
    ],
    captureStartMillis: 2_600,
    frameCount: 24,
    frameIntervalMillis: 90
  },
  tags: ["ritmo", "cooperativo", "multijugador", "typescript"]
};
