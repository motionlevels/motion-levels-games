import type { GameManifest } from "@motion-levels-games/game-sdk";
import type { PlatformGameCatalogEntry } from "./contracts";
import { isSupportedRuntimeSourceFromProducts } from "./runtimeSourcePolicy.ts";

type ManifestModule = { manifest: GameManifest };
declare const MOTION_LEVELS_GAMES_SOURCE_REVISION: string;
const manifestModules = import.meta.glob<ManifestModule>("../../../games/*/src/manifest.ts", { eager: true });
const publishedLevelProductIds = new Set(
  Object.values(manifestModules)
    .map((module) => module.manifest)
    .filter((manifest) => manifest.availability.production && manifest.tags?.includes("published-levels"))
    .map((manifest) => manifest.id.toLowerCase()),
);

export function isSupportedRuntimeSource(sourceKind: string | undefined, sourceGameId: string | undefined): boolean {
  return isSupportedRuntimeSourceFromProducts(sourceKind, sourceGameId, publishedLevelProductIds);
}

export function localPlayerExperienceCatalog(): PlatformGameCatalogEntry[] {
  return Object.values(manifestModules)
    .map((module) => module.manifest)
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(localCatalogEntry);
}

function localCatalogEntry(manifest: GameManifest, index: number): PlatformGameCatalogEntry {
  const difficulties = manifest.config?.difficulty?.options ?? ["easy", "medium", "hard", "expert"];
  const playersLabel = manifest.players.allowAny
    ? "Sin requisito"
    : manifest.players.min === manifest.players.max
      ? String(manifest.players.min)
      : `${manifest.players.min}-${manifest.players.max}`;
  return {
    id: manifest.id,
    engine_game: `motion-levels-games:${manifest.id}`,
    label: manifest.label,
    description: manifest.description ?? "",
    catalog_category: manifest.catalog.category,
    catalog_enabled: true,
    catalog_featured: index < 4,
    catalog_color: manifest.catalog.color,
    catalog_order: index,
    catalog_rules: [...manifest.catalog.rules],
    players_label: playersLabel,
    difficulty_label: difficulties.join("-"),
    duration_label: manifest.catalog.durationLabel,
    estimated_duration_seconds: Math.round(manifest.defaultDurationMillis / 1000),
    supports_levels: false,
    mode_label: manifest.catalog.modeLabel,
    audio_label: manifest.catalog.audioLabel,
    min_players: manifest.players.min,
    max_players: manifest.players.max,
    allow_any_players: manifest.players.allowAny,
    difficulties: [...difficulties],
    default_music_ref: "",
    default_music_volume: 1,
    source_kind: "motion_levels_games",
    source_revision: MOTION_LEVELS_GAMES_SOURCE_REVISION,
    source_contract_version: 2,
    source_game_id: manifest.id,
    source_available: true,
    code_editable: true,
    game_source: { schema: "motion-levels-games-v2", config: manifest.config },
  };
}
