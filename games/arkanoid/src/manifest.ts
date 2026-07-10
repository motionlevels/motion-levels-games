import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const arkanoidConfigVars = {
  ballSpeed: {
    key: "ball_speed",
    label: "Ball speed (tiles/s)",
    playerFacing: true,
    description: "Base ball speed on Easy. Higher difficulties multiply this value.",
    type: "float",
    default: 4.25,
    min: 2,
    max: 8,
    step: 0.25
  }
} satisfies Record<string, GameConfigVar>;

export const manifest: GameManifest = {
  id: "arkanoid",
  label: "Arkanoid",
  description: "Single-player floor Arkanoid with step-controlled paddle movement and deterministic brick physics.",
  players: {
    allowAny: true,
    min: 1,
    max: 1
  },
  start: { mode: "player-ready" },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    },
    vars: Object.values(arkanoidConfigVars)
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  tags: ["arcade", "single-player", "typescript"]
};
