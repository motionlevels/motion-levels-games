import type { GameManifest } from "@motion-levels-games/game-sdk";
import type { PlatformGameCatalogEntry } from "./contracts";

type ManifestModule = { manifest: GameManifest };
const manifestModules = import.meta.glob<ManifestModule>("../../../games/*/src/manifest.ts", { eager: true });

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
    source_kind: "motion-levels-games",
    source_contract_version: 1,
    source_game_id: manifest.id,
    source_available: true,
    code_editable: true,
    game_source: { schema: "motion-levels-games-v1", config: manifest.config },
  };
}
