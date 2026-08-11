import type { GameManifest } from "@motion-levels-games/game-sdk";

export const parkourGameId = "c1daea4f-e586-4116-8cbe-871cde887a81";
export const parkourEngineGame = "parkour";

export const manifest = {
  id: parkourGameId,
  slug: parkourEngineGame,
  aliases: [parkourEngineGame],
  label: "Parkour",
  description: "Supera plataformas, recoge objetivos y evita la lava en niveles editables.",
  availability: { development: true, production: true },
  catalog: {
    category: "individual",
    color: "#ff9f45",
    durationLabel: "Mejor tiempo",
    modeLabel: "Niveles",
    audioLabel: "Música + efectos",
    rules: [
      "Avanza por las plataformas verdes sin tocar la lava",
      "Recoge suficientes objetivos azules para superar cada nivel"
    ]
  },
  players: {
    allowAny: true,
    min: 1,
    max: 8
  },
  start: { mode: "immediate" },
  config: {
    difficulty: {
      default: "medium",
      options: ["easy", "medium", "hard"]
    },
    vars: []
  },
  defaultDurationMillis: 0,
  display: {
    entry: "./display"
  },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    actions: [{ atMillis: 3_100, type: "press", x: 7, y: 29 }],
    captureStartMillis: 3_180,
    frameCount: 18,
    frameIntervalMillis: 120
  },
  tags: ["published-levels", "platform-editable", "jugar-3d", "individual", "typescript"]
} satisfies GameManifest & { slug: string; aliases: string[] };
