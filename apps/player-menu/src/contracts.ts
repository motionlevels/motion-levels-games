import type { RGB } from "./color";
import type {
  PlayerExperienceFinishedAttempt,
  PlayerExperienceGameSummary,
  PlayerExperienceLevelSummary,
  PlayerExperiencePlayer,
  PlayerExperienceState,
} from "@motion-levels-games/player-experience";

export type EngineLevelSummary = PlayerExperienceLevelSummary;
export type EngineGame = PlayerExperienceGameSummary;

export type PlatformGameCatalogEntry = {
  id: string;
  engine_game: string;
  label: string;
  description: string;
  catalog_category: string;
  catalog_enabled: boolean;
  catalog_featured: boolean;
  catalog_color: string;
  catalog_order: number;
  catalog_thumbnail_ref?: string;
  catalog_preview_animation?: string;
  catalog_thumbnail_small_url?: string;
  catalog_thumbnail_url?: string;
  catalog_preview_url?: string;
  catalog_rules?: string[];
  players_label: string;
  difficulty_label: string;
  duration_label: string;
  estimated_duration_seconds: number;
  supports_levels: boolean;
  mode_label: string;
  audio_label: string;
  narration_text?: string;
  narration_audio_ref?: string;
  min_players: number;
  max_players: number;
  allow_any_players?: boolean;
  difficulties?: string[];
  default_music_ref: string;
  default_music_volume: number;
  countdown_floor_overlay?: boolean;
  source_kind: string;
  source_revision?: string;
  source_contract_version?: number;
  source_artifact_digest?: string;
  source_game_id?: string;
  source_available: boolean;
  code_editable: boolean;
  revision_hash?: string;
  game_source?: Record<string, unknown>;
  levels?: EngineLevelSummary[];
};

export type EnginePlayer = PlayerExperiencePlayer & { color: RGB };
export type FinishedLevelAttempt = PlayerExperienceFinishedAttempt;
export type EngineStatus = PlayerExperienceState & {
  venueSessionRecordingEnabled?: boolean;
  venueSessionStartedUnix?: number;
};
export type DisplayPlayer = EnginePlayer;
export type DisplayStatus = PlayerExperienceState;
