import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "hello-world",
  label: "Hola Mundo",
  description: "Sigue los objetivos verdes y evita las baldosas rojas.",
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
