import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "guardianes",
  label: "Guardianes",
  description: "Activa los cuatro escudos del suelo y protege el núcleo de una oleada de amenazas.",
  availability: { development: true, production: true },
  catalog: {
    category: "arcade",
    color: "#35d7ff",
    durationLabel: "42s",
    modeLabel: "Defensa cooperativa",
    audioLabel: "Efectos",
    rules: [
      "Entra en el núcleo central para iniciar",
      "Observa por qué carril baja cada amenaza",
      "Pisa el escudo del mismo color antes del impacto",
      "Protege las cuatro vidas del núcleo hasta el final"
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
  defaultDurationMillis: 42_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 8, y: 16 },
      { atMillis: 2_150, type: "release", x: 8, y: 16 },
      { atMillis: 3_100, type: "press", x: 2, y: 28 }
    ],
    captureStartMillis: 3_300,
    frameCount: 28,
    frameIntervalMillis: 100
  },
  tags: ["defensa", "cooperativo", "arcade", "multijugador", "typescript"]
};
