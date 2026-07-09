import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "meteor-dodge",
  label: "Lluvia de meteoritos",
  description: "Cooperative survival game: dodge telegraphed meteor impacts until the storm passes.",
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
  tags: ["arcade", "cooperative", "survival", "typescript"]
};
