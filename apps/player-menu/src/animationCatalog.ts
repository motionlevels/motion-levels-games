import type { PlatformGameCatalogEntry } from "./api";
import type { GameCard } from "./catalog";
import {
  animationLibraryById,
  animationMediaURL
} from "@motion-levels-games/animation-runtime";

const animationColors = ["#36d9ff", "#005af8", "#8dff6e", "#b987ff", "#ff9f45", "#ffd166"];

export function platformAnimationCards(catalog: PlatformGameCatalogEntry[] | null): GameCard[] {
  return (catalog || [])
    .filter((entry) => entry.source_kind === "animation")
    .flatMap((entry) => (entry.levels || []).filter((level) => !level.status || level.status === "published").map((level, index): GameCard => {
      const levelID = String(level.slug || level.id || "").trim();
      const previewRevisionHash = String(level.settings_hash || level.updated_at || entry.revision_hash || "").trim();
      const nativeMedia = nativeAnimationMediaSources(levelID);
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
        previewAnimation: nativeMedia ? undefined : `animation-${levelID}`,
        previewRevisionHash,
        ...nativeMedia,
        featured: false,
        minPlayers: 1,
        maxPlayers: 1,
        sourceKind: "animation",
      };
    }))
    .filter((game) => game.id !== "animation-");
}

export function nativeAnimationMediaSources(animationId: string): Pick<GameCard, "previewSrc" | "previewSrcs" | "thumbnailSrc" | "thumbnailSrcs"> | undefined {
  const id = animationId.trim().toLowerCase();
  if (!animationLibraryById.has(id)) return undefined;
  const appBaseURL = new URL(import.meta.env?.BASE_URL || "/", globalThis.location?.href || "http://localhost/");
  const thumbnailSrc = animationMediaURL(id, "thumbnailSmall", appBaseURL);
  const previewSrc = animationMediaURL(id, "animation", appBaseURL);
  return {
    thumbnailSrc,
    thumbnailSrcs: [thumbnailSrc],
    previewSrc,
    previewSrcs: [previewSrc]
  };
}
