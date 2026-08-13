// Spanish display titles for native runtime ids; level games use the runtime/catalog label.
import type { PlayerExperienceLifecycle } from "@motion-levels-games/player-experience";

const gameTitlesES: Record<string, string> = {
  "whack-a-mole": "Atrapa al topo",
  lava: "El suelo es lava",
  duel: "Duelo",
  "authored-memoria-v2": "Memoria v2",
  authoredmemoriav2: "Memoria v2",
  "memoria-v2": "Memoria v2",
  memoriav2: "Memoria v2",
  memory: "Reto de memoria",
  "memory-lights": "Reto de memoria",
  memorylights: "Reto de memoria",
  salvapantallas: "Salvapantallas",
  "ambient-comet": "Cometas",
  "ambient-pulse": "Pulso",
  "ambient-spark": "Chispas",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function compactText(value: string): string {
  return normalizedText(value).replace(/[^a-z0-9]+/g, "");
}

export function levelLabelES(value: string): string {
  const text = value.trim();
  if (!text) return "";

  const normalized = normalizedText(text);
  const direct = normalized.match(/^(?:nivel|level)\s*[-#:]*\s*(\d+)$/);
  if (direct) return `Nivel ${Number(direct[1])}`;

  const levelIndex = normalized.search(/(?:^|[^a-z0-9])(?:nivel|level)(?:[^a-z0-9]|$)/);
  if (levelIndex < 0) return "";

  const numbers = normalized.slice(levelIndex).match(/\d+/g);
  if (!numbers?.length) return "";
  return `Nivel ${Number(numbers[numbers.length - 1])}`;
}

export function gameTitleES(currentGame: string, label: string): string {
  const gameID = currentGame.trim();
  const knownTitle = gameTitlesES[gameID] || gameTitlesES[compactText(gameID)];
  if (knownTitle) return knownTitle;

  const cleanLabel = label.trim();
  const labelIsLevel = Boolean(levelLabelES(cleanLabel));
  if (cleanLabel && cleanLabel !== gameID && !labelIsLevel) return cleanLabel;
  if (gameID && labelIsLevel) return uuidPattern.test(gameID) ? "Juego de niveles" : gameID;
  return cleanLabel || gameID || "Motion Levels";
}

export function playerLifecycleLabelES(lifecycle: PlayerExperienceLifecycle): string {
  switch (lifecycle) {
    case "launching": return "Iniciando juego";
    case "waiting": return "Esperando inicio";
    case "starting": return "Preparados";
    case "running": return "Juego en curso";
    case "paused": return "Juego pausado";
    case "finished": return "Juego terminado";
    case "stopping": return "Finalizando juego";
    case "error": return "Error del juego";
    default: return "Juego seleccionado";
  }
}
