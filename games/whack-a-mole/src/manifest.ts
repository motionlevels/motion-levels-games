import type { GameManifest } from "@motion-levels-games/game-sdk";

const victoryNarrationDurationsMillis = [2_601, 3_019, 2_601, 2_972, 2_926, 3_111, 2_740, 3_158] as const;

export const manifest: GameManifest = {
  id: "whack-a-mole",
  label: "Atrapa al topo",
  description: "Persigue objetivos de colores por todo el suelo y atrápalos antes de que se apaguen.",
  availability: { development: true, production: true },
  catalog: {
    category: "versus", color: "#36d9ff", durationLabel: "60 s",
    modeLabel: "Todos contra todos", audioLabel: "Música + efectos",
    rules: ["Cada jugador ocupa su plataforma de salida", "Pisa los objetivos de tu color antes de que desaparezcan", "Cuanto más rápido llegues, más puntos ganas"]
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
      "mole-hit": [
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 0.97 },
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 0.99 },
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 1.01 },
        { ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.55, playbackRate: 1.03 }
      ],
      "target-expired": [{ ref: "audio/duelo/sfx/tile-claim.mp3", volume: 0.26, playbackRate: 0.72 }],
      win: [{ ref: "audio/duelo/sfx/victory.mp3", volume: 0.72 }]
    },
    narration: {
      intro: {
        ref: "audio/whack-a-mole/narration/intro.mp3",
        volume: 0.9,
        durationMillis: 26_796
      },
      victoryByPlayerIndex: Array.from({ length: 8 }, (_, index) => ({
        ref: `audio/duelo/narration/victory-player-${index + 1}.mp3`,
        volume: 0.92,
        durationMillis: victoryNarrationDurationsMillis[index]
      }))
    }
  },
  players: { allowAny: false, min: 1, max: 8 },
  start: { mode: "player-ready", countdownMillis: 3_000, releaseGraceMillis: 1_200 },
  config: { difficulty: { default: "medium", options: ["easy", "medium"] } },
  defaultDurationMillis: 60_000,
  display: { entry: "./display" },
  preview: {
    seed: 404, playerCount: 4, difficulty: "medium",
    actions: [{ atMillis: 100, type: "press", x: 0, y: 0 }, { atMillis: 100, type: "press", x: 12, y: 28 }, { atMillis: 100, type: "press", x: 0, y: 28 }, { atMillis: 100, type: "press", x: 12, y: 0 }],
    captureStartMillis: 3_300, frameCount: 18, frameIntervalMillis: 120
  },
  tags: ["arcade", "reaction", "multiplayer", "typescript"]
};
