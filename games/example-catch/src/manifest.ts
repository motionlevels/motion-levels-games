import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "example-catch",
  label: "Example Catch",
  description: "Step on the blue target before the 60 second timer expires.",
  players: {
    min: 1,
    max: 4
  },
  defaultDurationMillis: 60_000,
  display: {
    entry: "./display"
  },
  tags: ["example", "typescript", "local"]
};
