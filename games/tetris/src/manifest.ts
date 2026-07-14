import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const tetrisConfigVars = {
  linesToWin: { key: "lines_to_win", label: "Líneas para ganar", playerFacing: true, description: "Líneas que hay que eliminar para activar la celebración final.", type: "int", default: 10, min: 1, max: 40, step: 1 }
} satisfies Record<string, GameConfigVar>;

export const manifest: GameManifest = {
  id: "tetris", label: "Tetris",
  description: "Guía, rota y deja caer piezas físicas en una pista clásica de diez columnas.",
  availability: { development: true, production: true },
  catalog: { category: "arcade", color: "#36d9ff", durationLabel: "Sin límite", modeLabel: "Tetris clásico", audioLabel: "Música + efectos", rules: ["Pisa una columna para guiar la pieza", "Pisa las diagonales junto a tu guía para rotar", "Baja hasta el fondo para soltar la pieza y completa líneas"] },
  players: { allowAny: true, min: 1, max: 4 },
  start: { mode: "player-ready", releaseGraceMillis: 1_500 },
  config: { difficulty: { default: "medium", options: ["easy", "medium", "hard"] }, vars: Object.values(tetrisConfigVars) },
  defaultDurationMillis: 0,
  display: { entry: "./display" },
  preview: { seed: 137, playerCount: 1, difficulty: "medium", options: { lines_to_win: 10 }, actions: [{ atMillis: 100, type: "press", x: 8, y: 29 }], captureStartMillis: 2_200, frameCount: 18, frameIntervalMillis: 120 },
  tags: ["arcade", "puzzle", "classic", "typescript"]
};
