import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const dueloConfigVars = {
  baseFillPercent: {
    key: "base_fill_percent",
    label: "Floor coverage (%)",
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

const victoryNarrationDurationsMillis = [2_601, 3_019, 2_601, 2_972, 2_926, 3_111, 2_740, 3_158] as const;

export const manifest: GameManifest = {
  id: "duelo",
  label: "Duelo",
  description: "Una carrera para 2–8 jugadores: conquista todas las baldosas de tu color antes que los demás.",
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
  audio: {
    music: {
      waiting: { ref: "audio/duelo/music/waiting-loop.mp3", volume: 0.2 },
      starting: { ref: "audio/duelo/music/waiting-loop.mp3", volume: 0.22 },
      running: { ref: "audio/duelo/music/playing-loop.mp3", volume: 0.24 },
      finished: { ref: "audio/duelo/music/playing-loop.mp3", volume: 0.16 }
    },
    effects: {
      start: [{ ref: "audio/duelo/sfx/start.mp3", volume: 0.68 }],
      "tile-claim": [
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 0.97 },
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 0.99 },
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 1.01 },
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 1.03 }
      ],
      win: [{ ref: "audio/duelo/sfx/victory.mp3", volume: 0.72 }]
    },
    narration: {
      intro: { ref: "audio/duelo/narration/intro.mp3", volume: 0.9, durationMillis: 18_715 },
      victoryByPlayerIndex: Array.from({ length: 8 }, (_, index) => ({
        ref: `audio/duelo/narration/victory-player-${index + 1}.mp3`,
        volume: 0.92,
        durationMillis: victoryNarrationDurationsMillis[index]
      }))
    }
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
