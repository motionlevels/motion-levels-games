import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "meteor-dodge",
  label: "Lluvia de meteoritos",
  description: "Cooperative survival game: dodge telegraphed meteor impacts until the storm passes.",
  availability: { development: true, production: false },
  catalog: {
    category: "team",
    color: "#b987ff",
    durationLabel: "45s",
    modeLabel: "Supervivencia",
    audioLabel: "Efectos",
    rules: ["Esquiva las zonas marcadas", "Sobrevive hasta que termine la tormenta"]
  },
  players: {
    allowAny: true,
    min: 1,
    max: 1
  },
  start: {
    mode: "player-ready",
    releaseGraceMillis: 750
  },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 45_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 1,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 16 },
      { atMillis: 2_150, type: "release", x: 8, y: 16 }
    ],
    captureStartMillis: 2_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["arcade", "cooperative", "survival", "typescript"]
};
