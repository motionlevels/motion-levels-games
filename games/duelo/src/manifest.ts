import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const dueloConfigVars = {
  baseFillPercent: {
    key: "base_fill_percent",
    label: "Base floor coverage (%)",
    playerFacing: false,
    description: "The percentage of floor tiles assigned as targets on Medium difficulty.",
    type: "int",
    default: 60,
    min: 30,
    max: 75,
    step: 5
  },
  hardFillMultiplier: {
    key: "hard_fill_multiplier",
    label: "Hard coverage multiplier",
    playerFacing: false,
    description: "Hard difficulty multiplies the base floor coverage by this value, capped at the full floor.",
    type: "float",
    default: 1.5,
    min: 1,
    max: 1.8,
    step: 0.05
  }
} satisfies Record<string, GameConfigVar>;

export const manifest: GameManifest = {
  id: "duelo",
  label: "Duelo",
  description: "A fast 2–8 player race to claim every tile of your color before anyone else.",
  availability: { development: true, production: true },
  catalog: {
    category: "versus",
    color: "#ff5268",
    durationLabel: "Sin límite",
    modeLabel: "Carrera de colores",
    audioLabel: "Música + efectos",
    rules: [
      "Cada jugador ocupa la zona de inicio de su color",
      "Pisa todas las baldosas de tu color antes que los demás"
    ]
  },
  players: {
    allowAny: false,
    min: 2,
    max: 8
  },
  start: {
    mode: "player-ready",
    countdownMillis: 3_000,
    releaseGraceMillis: 2_000
  },
  config: {
    difficulty: {
      default: "medium",
      options: ["medium", "hard"]
    },
    vars: Object.values(dueloConfigVars)
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 4,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 1, y: 1 },
      { atMillis: 100, type: "press", x: 14, y: 30 },
      { atMillis: 100, type: "press", x: 1, y: 30 },
      { atMillis: 100, type: "press", x: 14, y: 1 }
    ],
    captureStartMillis: 3_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["competitive", "multiplayer", "color-race", "typescript"]
};
