import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "ping-pong",
  label: "Ping Pong",
  description: "Two-player arcade ping pong for red and blue halves of the Motion Levels floor.",
  players: {
    allowAny: true,
    min: 2,
    max: 2
  },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    },
    vars: [
      {
        key: "points_to_win",
        label: "Points",
        type: "int",
        default: 5,
        min: 1,
        max: 21,
        step: 1
      }
    ]
  },
  defaultDurationMillis: 0,
  defaultSeed: 202,
  display: {
    entry: "./display"
  },
  tags: ["arcade", "two-player", "typescript"]
};
