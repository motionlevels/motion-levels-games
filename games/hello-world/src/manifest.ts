import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "hello-world",
  label: "Hello World",
  description: "A tiny deterministic example game for CI playtests and new game authors.",
  players: {
    allowAny: true,
    min: 1,
    max: 1
  },
  start: { mode: "player-ready" },
  defaultDurationMillis: 30_000,
  display: {
    entry: "./display"
  },
  tags: ["example", "ci", "typescript"]
};
