import { allDifficultyIDs, type DifficultyID } from "./difficulties";

export type { DifficultyID } from "./difficulties";

export const colors = {
  cyan: "#36d9ff",
  green: "#8dff6e",
  yellow: "#ffd166",
  red: "#ff5268",
  violet: "#b987ff",
  orange: "#ff9f45",
  blue: "#005af8",
};

// Eight fully saturated, easy-to-distinguish player colors.
export const playerColors = [
  "#ff0000", // rojo
  "#00ffff", // cian
  "#00ff00", // verde
  "#ff00ff", // rosa
  "#0000ff", // azul
  "#ffff00", // amarillo
  "#ff8000", // naranja
  "#8000ff", // morado
];

export const playerColorNames = ["Rojo", "Cian", "Verde", "Rosa", "Azul", "Amarillo", "Naranja", "Morado"];
export const nameHints = playerColorNames;

export type CategoryID = "featured" | "team" | "versus" | "individual" | "arcade" | "attract";

export type Category = {
  id: CategoryID;
  label: string;
  title: string;
  color: string;
  icon: string;
};

export const categories: Category[] = [
  { id: "featured", label: "Destacados", title: "Listos para jugar", color: colors.blue, icon: "*" },
  { id: "team", label: "Cooperativos", title: "Jugad en equipo", color: colors.blue, icon: "team" },
  { id: "versus", label: "Competitivos", title: "Cara a cara", color: colors.blue, icon: "vs" },
  { id: "individual", label: "Individual", title: "Retos individuales", color: colors.blue, icon: "1" },
  { id: "arcade", label: "Arcade", title: "Arcade", color: colors.blue, icon: "arcade" },
  { id: "attract", label: "Ambiente", title: "Modos ambiente", color: colors.blue, icon: "ambient" },
];

export type Difficulty = {
  id: DifficultyID;
  label: string;
  color: string;
};

export const difficulties: Difficulty[] = [
  { id: "easy", label: "Fácil", color: colors.blue },
  { id: "medium", label: "Media", color: colors.yellow },
  { id: "hard", label: "Difícil", color: colors.orange },
  { id: "expert", label: "Experto", color: colors.red },
];

export type GameConfigVarType = "int" | "float" | "bool" | "enum";

// Player-facing game variable declared by the platform games editor
// (game_source.config.vars with player_facing). Values chosen in the menu's
// settings dialog travel with /api/select and reach the game code via init.
export type GameConfigVar = {
  key: string;
  label: string;
  description?: string;
  type: GameConfigVarType;
  default?: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label?: string }>;
};

export type GameCard = {
  id: string;
  label: string;
  category: CategoryID;
  color: string;
  players: string;
  difficulty: string;
  duration: string;
  estimatedDurationSeconds?: number;
  mode: string;
  audio: string;
  description: string;
  rules: string[];
  levels?: GameLevel[];
  partyMiniGames?: PartyMiniGame[];
  allowDifficultyWithLevels?: boolean;
  difficulties?: DifficultyID[];
  engineGame?: string;
  maxPlayers?: number;
  minPlayers?: number;
  allowAnyPlayers?: boolean;
  thumbnailSrc?: string;
  thumbnailSrcs?: string[];
  previewSrc?: string;
  previewSrcs?: string[];
  previewAnimation?: string;
  animationID?: string;
  previewRevisionHash?: string;
  featured?: boolean;
  supportsLevels?: boolean;
  sourceKind?: string;
  sourceRevision?: string;
  sourceGameId?: string;
  countdownFloorOverlay?: boolean;
  revisionHash?: string;
  disabled?: boolean;
  configVars?: GameConfigVar[];
};

export type PartyMiniGame = {
  gameId: string;
  label?: string;
  difficultyMode?: "inherit" | "override";
  difficulty?: DifficultyID;
  level?: string;
};

export type GameLevel = {
  id: string;
  slug?: string;
  canonicalIdsByDifficulty?: Partial<Record<DifficultyID, string>>;
  label: string;
  description: string;
  difficulties?: DifficultyID[];
  thumbnailSrc?: string;
  thumbnailSrcs?: string[];
  previewSrc?: string;
  previewSrcs?: string[];
  previewByDifficulty?: Partial<Record<DifficultyID, string>>;
  previewAnimation?: string;
  previewRevisionHash?: string;
};

export const games: GameCard[] = [
  {
    id: "lava",
    label: "El suelo es lava",
    category: "featured",
    color: colors.red,
    players: "Sin requisito",
    difficulty: "Fácil-Experto",
    duration: "60s",
    estimatedDurationSeconds: 60,
    minPlayers: 1,
    maxPlayers: 6,
    allowAnyPlayers: true,
    difficulties: [...allDifficultyIDs],
    mode: "Plataformas",
    audio: "Música + efectos",
    description: "Moveos en equipo, evitad la lava y conquistad plataformas seguras durante un minuto.",
    rules: ["Espera en la zona azul.", "Pisa las plataformas verdes.", "Evita la lava roja durante un minuto."],
    engineGame: "motion-levels-games:lava",
    sourceKind: "motion_levels_games",
    sourceGameId: "lava",
    previewAnimation: "lava",
    featured: true,
  },
];
