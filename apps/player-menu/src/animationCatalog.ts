import type { PlatformGameCatalogEntry } from "./api";
import type { GameCard } from "./catalog";

const animationColors = ["#36d9ff", "#005af8", "#8dff6e", "#b987ff", "#ff9f45", "#ffd166"];

export function platformAnimationCards(catalog: PlatformGameCatalogEntry[] | null): GameCard[] {
  return (catalog || [])
    .filter((entry) => entry.source_kind === "animation")
    .flatMap((entry) => (entry.levels || []).filter((level) => !level.status || level.status === "published").map((level, index): GameCard => {
      const levelID = String(level.slug || level.id || "").trim();
      const previewRevisionHash = String(level.settings_hash || level.updated_at || entry.revision_hash || "").trim();
      return {
        id: `animation-${levelID}`,
        label: level.label || levelID,
        category: "attract",
        color: animationColors[index % animationColors.length],
        players: "Todos",
        difficulty: "Ambiente",
        duration: "Bucle",
        mode: "Ambiente",
        audio: entry.default_music_ref ? "Música" : "Suave",
        description: level.description || "Animación visible desde el editor.",
        rules: ["Animación visible desde el editor.", "Se guarda en caché local para abrir el menú más rápido."],
        engineGame: `animation-${levelID}`,
        previewAnimation: `animation-${levelID}`,
        previewRevisionHash,
        featured: false,
        minPlayers: 1,
        maxPlayers: 1,
        sourceKind: "animation",
      };
    }))
    .filter((game) => game.id !== "animation-");
}
