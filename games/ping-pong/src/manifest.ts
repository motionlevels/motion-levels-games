import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "ping-pong",
  label: "Ping Pong",
  description: "Two-player arcade ping pong for red and blue halves of the Motion Levels floor.",
  players: {
    min: 2,
    max: 2
  },
  defaultDurationMillis: 0,
  defaultSeed: 202,
  display: {
    entry: "./display"
  },
  tags: ["arcade", "two-player", "typescript"]
};
