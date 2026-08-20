import type { PlatformGameCatalogEntry } from "./api";
import type { GameCard } from "./catalog";
import {
  animationLibrary,
  animationLibraryById,
  animationMediaReferences,
} from "@motion-levels-games/animation-runtime";
import {
  bundledGamesSourceRevision,
  revisionedBundleMediaURL,
  type PlayerMenuLocation,
} from "./bundleMedia.ts";
import { catalogDirectAssetSrc, uniquePreviewSources } from "./previews.ts";

const animationColors = ["#36d9ff", "#005af8", "#8dff6e", "#b987ff", "#ff9f45", "#ffd166"];

/**
 * The native animation library is part of the games bundle. Keep it
 * available while the platform catalog is offline; a successful platform
 * catalog still controls which editor-published animation levels are shown.
 */
export function nativeAnimationCards(
  options: { menuLocation?: PlayerMenuLocation; sourceRevision?: string } = {},
): GameCard[] {
  return animationLibrary.map((animation, index): GameCard => {
    const media = nativeAnimationMediaSources(animation.id, options);
    return {
      id: `animation-${animation.id}`,
      label: animation.label,
      category: "attract",
      color: animationColors[index % animationColors.length],
      players: "Todos",
      difficulty: "Ambiente",
      duration: "Bucle",
      mode: "Ambiente",
      audio: "Suave",
      description: animation.description,
      rules: ["Pisa la pista para crear ondas y destellos.", "Las animaciones se repiten sin cortes."],
      engineGame: `animation-${animation.id}`,
      previewRevisionHash: options.sourceRevision ?? bundledGamesSourceRevision(),
      ...media,
      featured: false,
      minPlayers: 1,
      maxPlayers: 1,
      sourceKind: "animation",
      sourceGameId: animation.id,
    };
  });
}

export function platformAnimationCards(catalog: PlatformGameCatalogEntry[] | null): GameCard[] {
  return (catalog || [])
    .filter((entry) => entry.source_kind === "animation")
    .flatMap((entry) => (entry.levels || []).filter((level) => !level.status || level.status === "published").map((level, index): GameCard => {
      const levelID = String(level.slug || level.id || "").trim();
      const previewRevisionHash = String(level.settings_hash || level.updated_at || entry.revision_hash || "").trim();
      const nativeMedia = nativeAnimationMediaSources(levelID);
      const media = animationCardMediaSources(level, nativeMedia);
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
        previewAnimation: media ? undefined : `animation-${levelID}`,
        previewRevisionHash,
        ...media,
        featured: false,
        minPlayers: 1,
        maxPlayers: 1,
        sourceKind: "animation",
      };
    }))
    .filter((game) => game.id !== "animation-");
}

function animationCardMediaSources(
  level: NonNullable<PlatformGameCatalogEntry["levels"]>[number],
  nativeMedia: ReturnType<typeof nativeAnimationMediaSources>,
): Pick<GameCard, "previewSrc" | "previewSrcs" | "thumbnailSrc" | "thumbnailSrcs"> | undefined {
  const authoredThumbnailSrcs = uniquePreviewSources([
    catalogDirectAssetSrc(level.catalog_thumbnail_small_url),
    catalogDirectAssetSrc(level.catalog_thumbnail_url),
  ]);
  const authoredPreviewSrcs = uniquePreviewSources([
    catalogDirectAssetSrc(level.catalog_preview_url),
  ]);
  const thumbnailSrcs = uniquePreviewSources([
    ...authoredThumbnailSrcs,
    ...(nativeMedia?.thumbnailSrcs || []),
    nativeMedia?.thumbnailSrc,
  ]);
  const previewSrcs = uniquePreviewSources([
    ...authoredPreviewSrcs,
    ...(nativeMedia?.previewSrcs || []),
    nativeMedia?.previewSrc,
  ]);
  if (!thumbnailSrcs.length && !previewSrcs.length) return undefined;
  return {
    thumbnailSrc: thumbnailSrcs[0] || previewSrcs[0],
    thumbnailSrcs,
    previewSrc: previewSrcs[0] || thumbnailSrcs[0],
    previewSrcs,
  };
}

export function nativeAnimationMediaSources(
  animationId: string,
  options: { menuLocation?: PlayerMenuLocation; sourceRevision?: string } = {},
): Pick<GameCard, "previewSrc" | "previewSrcs" | "thumbnailSrc" | "thumbnailSrcs"> | undefined {
  const id = animationId.trim().toLowerCase();
  if (!animationLibraryById.has(id)) return undefined;
  const references = animationMediaReferences(id);
  const sourceRevision = options.sourceRevision ?? bundledGamesSourceRevision();
  const thumbnailSrc = revisionedBundleMediaURL(references.thumbnailSmall, sourceRevision, options.menuLocation);
  const previewSrc = revisionedBundleMediaURL(references.animation, sourceRevision, options.menuLocation);
  return {
    thumbnailSrc,
    thumbnailSrcs: [thumbnailSrc],
    previewSrc,
    previewSrcs: [previewSrc]
  };
}
