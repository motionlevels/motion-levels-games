import { animationLibrary } from "@motion-levels-games/animation-runtime";
import type { GameConfigVar, GameManifest } from "@motion-levels-games/game-sdk";

export const animationOption = {
  key: "animation",
  label: "Animación",
  description: "Animación nativa que se muestra cuando el modo es individual",
  playerFacing: true,
  type: "enum",
  default: "aurora",
  options: animationLibrary.map((animation) => ({ value: animation.id, label: animation.label }))
} satisfies GameConfigVar;

export const modeOption = {
  key: "mode",
  label: "Modo",
  description: "Muestra una animación o recorre automáticamente toda la biblioteca",
  playerFacing: true,
  type: "enum",
  default: "single",
  options: [
    { value: "single", label: "Individual" },
    { value: "rotation", label: "Rotación" }
  ]
} satisfies GameConfigVar;

export const speedOption = {
  key: "speed",
  label: "Velocidad",
  description: "Multiplicador de velocidad de la animación",
  playerFacing: false,
  type: "float",
  default: 1,
  min: 0.25,
  max: 3,
  step: 0.05
} satisfies GameConfigVar;

export const rotationSecondsOption = {
  key: "rotationSeconds",
  label: "Rotación",
  description: "Segundos que permanece cada animación en el salvapantallas",
  playerFacing: false,
  type: "int",
  default: 20,
  min: 5,
  max: 3600,
  step: 5
} satisfies GameConfigVar;

export const manifest: GameManifest = {
  id: "a861f0dc-3e2e-4fe9-b487-33194af75b68",
  slug: "animations",
  aliases: ["animations", "salvapantallas", "ambient-animations"],
  label: "Animaciones",
  description: "Biblioteca de animaciones ambientales nativas y reactivas para la pista.",
  availability: { development: true, production: true },
  catalog: {
    category: "arcade",
    color: "#42ffd2",
    durationLabel: "Continuo",
    modeLabel: "Ambiental",
    audioLabel: "Efectos opcionales",
    rules: [
      "Elige una animación o activa la rotación automática",
      "Pisa la pista para crear ondas y destellos",
      "Las animaciones se repiten sin cortes"
    ]
  },
  players: { allowAny: true, min: 1, max: 8 },
  start: { mode: "immediate" },
  config: {
    difficulty: { default: "medium", options: ["medium"] },
    vars: [modeOption, animationOption, speedOption, rotationSecondsOption]
  },
  defaultDurationMillis: 0,
  display: { entry: "./display" },
  preview: {
    seed: 137,
    playerCount: 0,
    difficulty: "medium",
    options: { mode: "single", animation: "neon-ribbons", speed: 1, rotationSeconds: 20 },
    actions: [
      { atMillis: 1_200, type: "press", x: 8, y: 16 },
      { atMillis: 1_350, type: "release", x: 8, y: 16 }
    ],
    captureStartMillis: 800,
    frameCount: 24,
    frameIntervalMillis: 100
  },
  tags: ["ambiental", "salvapantallas", "animaciones", "typescript"]
};
