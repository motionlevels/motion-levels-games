import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "arkanoid",
  label: "Arkanoid",
  description: "Single-player floor Arkanoid with step-controlled paddle movement and deterministic brick physics.",
  players: {
    min: 1,
    max: 1
  },
  start: { mode: "player-ready" },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  tags: ["arcade", "single-player", "typescript"]
};
