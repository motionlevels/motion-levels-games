import type { GameManifest } from "@motion-levels-games/game-sdk";

export const temporada1GameId = "4773837e-3565-49d7-8953-3b40f59fca7b";
export const temporada1EngineGame = "temporada1-niveles";

export const manifest = {
  id: temporada1GameId,
  slug: temporada1EngineGame,
  aliases: [temporada1EngineGame],
  label: "Temporada 1",
  description: "Ruta cooperativa de 24 niveles con puntos, peligros y retos clásicos de la pista.",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#8dff6e",
    durationLabel: "Por nivel",
    modeLabel: "Temporada",
    audioLabel: "Música + efectos",
    rules: [
      "Recoge todos los objetivos azules y morados",
      "Los objetivos morados necesitan dos pisadas y las baldosas rojas quitan vidas"
    ]
  },
  players: {
    allowAny: false,
    min: 1,
    max: 6
  },
  start: { mode: "immediate" },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard", "expert"]
    },
    vars: []
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 4,
    difficulty: "medium",
    actions: [{ atMillis: 3_100, type: "press", x: 7, y: 29 }],
    captureStartMillis: 3_180,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["published-levels", "platform-editable", "jugar-3d", "team", "typescript"]
} satisfies GameManifest & { slug: string; aliases: string[] };
