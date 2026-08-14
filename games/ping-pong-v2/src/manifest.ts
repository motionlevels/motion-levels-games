import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const pingPongV2ConfigVars = {
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
    description: "Starting ball speed on Easy before applying the difficulty curve.",
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
    description: "Rally acceleration after each successful paddle return.",
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
    description: "Per-level multiplier for starting speed and return acceleration.",
    type: "float",
    default: 1.2,
    min: 1,
    max: 1.35,
    step: 0.05
  }
} satisfies Record<string, GameConfigVar>;

export const manifest: GameManifest = {
  id: "ping-pong-v2",
  label: "Ping Pong v2",
  description: "La versión competitiva de Ping Pong: peloteos acelerados y partidas al mejor de cinco puntos.",
  availability: { development: true, production: true },
  catalog: {
    category: "versus", color: "#145cff", durationLabel: "A 5 puntos",
    modeLabel: "Rojo contra azul", audioLabel: "Música + efectos",
    rules: ["Un equipo ocupa la mitad roja y otro la azul", "Mueve la pala pisando tu mitad", "Cada devolución acelera la pelota"]
  },
  players: { allowAny: true, min: 2, max: 2 },
  start: { mode: "player-ready", releaseGraceMillis: 1_000 },
  config: {
    difficulty: { default: "medium", options: ["easy", "medium", "hard", "expert"] },
    vars: Object.values(pingPongV2ConfigVars)
  },
  defaultDurationMillis: 0,
  display: { entry: "./display" },
  preview: {
    seed: 202, playerCount: 2, difficulty: "medium", options: { points_to_win: 5 },
    actions: [{ atMillis: 100, type: "press", x: 7, y: 3 }, { atMillis: 100, type: "press", x: 7, y: 28 }],
    captureStartMillis: 2_200, frameCount: 18, frameIntervalMillis: 120
  },
  tags: ["arcade", "versus", "typescript", "v2"]
};
