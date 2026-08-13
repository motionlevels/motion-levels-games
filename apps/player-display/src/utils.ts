import type { PlayerExperienceColor } from "@motion-levels-games/player-experience";

export { gameTitleES, levelLabelES } from "./displayText";

export function colorCSS(color: PlayerExperienceColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function colorRGB(color: PlayerExperienceColor): string {
  return `${color.r}, ${color.g}, ${color.b}`;
}

export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case "intro":
      return "Introducción";
    case "ready":
      return "Pisa para empezar";
    case "countdown":
      return "Preparados";
    case "memorize":
      return "Memoriza";
    case "running":
      return "Ronda en directo";
    case "passed":
      return "Nivel superado";
    case "failed":
      return "Nivel fallido";
    case "finished":
      return "Ronda completada";
    case "ambient":
      return "Modo ambiente";
    default:
      return "En espera";
  }
}

const colorNamesES: Record<string, string> = {
  red: "Rojo",
  orange: "Naranja",
  yellow: "Amarillo",
  green: "Verde",
  cyan: "Cian",
  blue: "Azul",
  pink: "Rosa",
  purple: "Morado",
  violet: "Morado",
  magenta: "Rosa",
};

// Engine sends color-based player labels in English (e.g. "Blue"); show them in Spanish.
export function playerLabelES(label: string): string {
  return colorNamesES[label.trim().toLowerCase()] || label;
}

// Some engine event messages are still English; translate the known ones while preserving
// already-localized, informative messages (e.g. lava's "Plataforma nueva · 3").
const eventMessagesES: Record<string, string> = {
  start: "¡A jugar!",
  starting: "¡A jugar!",
  miss: "Fallo",
  "time up": "¡Tiempo!",
  win: "¡Tiempo!",
  finished: "¡Tiempo!",
};

export function eventMessageES(cue: string, message: string): string {
  const text = (message || "").trim();
  if (!text) return cue ? eventMessagesES[cue.toLowerCase()] || "" : "";
  const direct = eventMessagesES[text.toLowerCase()];
  if (direct) return direct;
  // "<Color> +N" score events: translate the color word, keep the delta.
  const hit = text.match(/^(\p{L}+)\s*(\+\d+)$/u);
  if (hit) return `${playerLabelES(hit[1])} ${hit[2]}`;
  return text;
}

export function difficultyLabelES(difficulty: string): string {
  switch (difficulty) {
    case "easy":
      return "Fácil";
    case "medium":
      return "Media";
    case "hard":
      return "Difícil";
    case "expert":
      return "Experto";
    default:
      return difficulty || "—";
  }
}
