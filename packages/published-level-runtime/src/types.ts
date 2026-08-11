import type {
  GameContent,
  GameInstance,
  GameManifest,
  GameSnapshot,
  HexColor,
  PlayerReadyZone
} from "@motion-levels-games/game-sdk";

export const PUBLISHED_LEVEL_CONTENT_SCHEMA = "motion-levels-published-level-content-v1";

export type PublishedLevelMode = "challenge" | "free";
export type PublishedLevelCell = readonly [x: number, y: number, kind: number, uniq?: string];

export type PublishedLevelFrame = Readonly<{
  r: number;
  c: readonly PublishedLevelCell[];
}>;

export type PublishedLevelDifficultySetting = Readonly<{
  life?: number;
  frame_duration_ms?: number;
  gameplay_lives?: number;
  gameplay_time_limit_seconds?: number;
  speed_multiplier?: number;
}>;

export type PublishedLevelRules = Readonly<{
  victory_condition?: "collect_all" | "score_at_least" | string;
  difficulty_settings?: Readonly<Record<string, PublishedLevelDifficultySetting>>;
  difficulty_changes_layout?: boolean;
  red_floor_animation?: "none" | "parkour_lava" | string;
  red_damage_grace_period?: boolean;
  green_platform_load_animation?: boolean;
  green_platform_load_side?: "left" | "right" | string;
  green_platform_disappear?: boolean;
  green_platform_impact_ripple?: boolean;
  blue_platform_turn_green?: boolean;
  blue_platform_capture_area?: boolean;
}>;

export type PublishedResultAnimations = Readonly<{
  victory_animations?: readonly string[];
  defeat_animations?: readonly string[];
}>;

export type PublishedLevelRecord = Readonly<{
  id: string;
  slug: string;
  settings_hash?: string;
  label: string;
  description?: string;
  difficulty?: string;
  life?: number;
  pass_score?: number;
  time_limit_seconds?: number;
  frame_tick_ms?: number;
  rules?: PublishedLevelRules;
  result_animations?: PublishedResultAnimations;
  music_ref?: string;
  music_volume?: number;
  narration_cue_ref?: string;
  start_cue_ref?: string;
  coin_cue_ref?: string;
  double_coin_cue_ref?: string;
  damage_cue_ref?: string;
  win_cue_ref?: string;
  defeat_cue_ref?: string;
  frames: readonly PublishedLevelFrame[];
}>;

export type PublishedAnimationRecord = Readonly<{
  id?: string;
  slug: string;
  frame_tick_ms?: number;
  tile_effects?: Readonly<Record<string, Readonly<{ color?: string }>>>;
  frames?: readonly PublishedLevelFrame[];
}>;

export type PublishedLevelContent = GameContent & Readonly<{
  schema: typeof PUBLISHED_LEVEL_CONTENT_SCHEMA;
  gameId: string;
  engineGame: string;
  contentRevision: string;
  selectedLevelId: string;
  selectedLevelSlug: string;
  mode: PublishedLevelMode;
  levels: readonly PublishedLevelRecord[];
  resultAnimations: readonly PublishedAnimationRecord[];
}>;

export type PublishedLevelAudio = Readonly<{
  musicRef: string;
  musicVolume: number;
  narrationCueRef: string;
  startCueRef: string;
  coinCueRef: string;
  doubleCoinCueRef: string;
  damageCueRef: string;
  winCueRef: string;
  defeatCueRef: string;
}>;

export type PublishedLevelPlayerSnapshot = Readonly<{
  index: number;
  label: string;
  color: HexColor;
  score: number;
  lives: number;
}>;

export type PublishedLevelSnapshot = GameSnapshot & Readonly<{
  currentGame: string;
  engineGame: string;
  contentRevision: string;
  lastEventMillis: number;
  phase: "countdown" | "running" | "finished";
  difficulty: string;
  level: string;
  levelSlug: string;
  levelNumber: number;
  levelCount: number;
  levelLabel: string;
  levelDescription: string;
  isFinalLevel: boolean;
  objectivesTotal: number;
  objectivesRemaining: number;
  resultMillis: number;
  mode: PublishedLevelMode;
  maxLives: number;
  countdownMillis: number;
  attemptCreatedMillis: number;
  attemptStartedMillis: number;
  attemptEndedMillis: number;
  audio: PublishedLevelAudio;
}>;

export type PublishedLevelSemanticTile = Readonly<{
  x: number;
  y: number;
  kind: number;
  originalKind: number;
  uniq: string;
  present: boolean;
  removed: boolean;
  primed: boolean;
}>;

export type PublishedLevelGameInstance = Omit<GameInstance, "snapshot"> & Readonly<{
  playerReadyZones(): PlayerReadyZone[];
  snapshot(): PublishedLevelSnapshot;
  semanticTiles(atMillis?: number): readonly PublishedLevelSemanticTile[];
  dangerAt(x: number, y: number, atMillis?: number): number;
}>;

export type PublishedLevelProduct = Readonly<{
  manifest: GameManifest;
  fallbackContent: PublishedLevelContent;
}>;

export type PublishedLevelContentInput = Readonly<{
  gameId: string;
  engineGame: string;
  contentRevision?: string;
  selectedLevelId?: string;
  selectedLevelSlug?: string;
  mode?: PublishedLevelMode;
  levelsPayload: unknown;
  resultAnimationsPayload?: unknown;
}>;
