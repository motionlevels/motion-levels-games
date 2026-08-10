import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: "suelo-seguro",
  label: "Suelo Seguro",
  description: "El equipo enlaza refugios de 2×2 en el perímetro, comparte vidas y compite por completar los relevos en el menor tiempo.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#5fff9e",
    durationLabel: "90s",
    modeLabel: "Relevos cooperativos",
    audioLabel: "Efectos",
    rules: [
      "Cada jugador empieza en un refugio de 2×2 del perímetro",
      "Los refugios aparecen separados y siempre en el borde",
      "El tiempo de cada relevo se suma al equipo: menos es mejor",
      "Evitad el bloque rojo de 8×8; las vidas son compartidas"
    ]
  },
  players: {
    allowAny: false,
    min: 1,
    max: 8
  },
  start: { mode: "player-ready", countdownMillis: 2_000, releaseGraceMillis: 1_500 },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    }
  },
  defaultDurationMillis: 90_000,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 4,
    difficulty: "medium",
    actions: [
      { atMillis: 100, type: "press", x: 0, y: 0 },
      { atMillis: 180, type: "press", x: 14, y: 0 },
      { atMillis: 260, type: "press", x: 14, y: 30 },
      { atMillis: 340, type: "press", x: 0, y: 30 },
      { atMillis: 2_450, type: "release", x: 0, y: 0 }
    ],
    captureStartMillis: 2_700,
    frameCount: 30,
    frameIntervalMillis: 100
  },
  tags: ["plataformas", "cooperativo", "turnos", "reflejos", "multijugador", "typescript"]
};
