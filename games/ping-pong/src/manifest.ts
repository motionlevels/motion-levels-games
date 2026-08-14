import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const pingPongConfigVars = {
  pointsToWin: {
    key: "points_to_win",
    label: "Puntos para ganar",
    playerFacing: true,
    description: "Gana el primer equipo que alcance esta puntuación.",
    type: "int",
    default: 5,
    min: 1,
    max: 21,
    step: 1
  },
  initialBallSpeed: {
    key: "initial_ball_speed",
    label: "Initial ball speed (tiles/s)",
    playerFacing: false,
    description: "The ball's starting speed in floor tiles per second on Easy. Medium, Hard, and Expert apply the difficulty multiplier curve to this value.",
    type: "float",
    default: 5.75,
    min: 3,
    max: 10,
    step: 0.25
  },
  returnSpeedMultiplier: {
    key: "return_speed_multiplier",
    label: "Speed multiplier per return",
    playerFacing: false,
    description: "The ball accelerates after every successful paddle return. Difficulty scales the increase above 1x, with a safety cap at 2.5 times the starting speed.",
    type: "float",
    default: 1.035,
    min: 1,
    max: 1.1,
    step: 0.005
  },
  difficultyMultiplier: {
    key: "difficulty_multiplier",
    label: "Difficulty multiplier step",
    playerFacing: false,
    description: "Easy uses 1x, Medium uses one step, Hard uses the step squared, and Expert uses the step cubed. It affects both starting speed and return acceleration.",
    type: "float",
    default: 1.2,
    min: 1,
    max: 1.35,
    step: 0.05
  }
} satisfies Record<string, GameConfigVar>;

export const manifest: GameManifest = {
  id: "ping-pong",
  label: "Ping Pong",
  description: "Ping Pong para dos equipos: defended vuestra mitad y devolved la pelota antes de que salga.",
  availability: { development: true, production: true },
  catalog: {
    category: "versus",
    color: "#145cff",
    durationLabel: "A 5 puntos",
    modeLabel: "Rojo contra azul",
    audioLabel: "Música + efectos",
    rules: ["Un equipo ocupa la mitad roja y otro la azul", "Devuelve la pelota pisando la zona iluminada"]
  },
  players: {
    allowAny: true,
    min: 2,
    max: 2
  },
  start: {
    mode: "player-ready",
    releaseGraceMillis: 1_000
  },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    },
    vars: Object.values(pingPongConfigVars)
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 2,
    difficulty: "medium",
    options: { points_to_win: 5 },
    actions: [
      { atMillis: 100, type: "press", x: 7, y: 3 },
      { atMillis: 100, type: "press", x: 7, y: 28 }
    ],
    captureStartMillis: 2_200,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["arcade", "two-player", "typescript"]
};
