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
import { publicAssetURL } from "./utils.ts";

const animationColors = ["#36d9ff", "#005af8", "#8dff6e", "#b987ff", "#ff9f45", "#ffd166"];
// Keep the player-menu package boundary on animation-runtime. This is the
// immutable product id owned by games/animations/src/manifest.ts.
export const nativeAnimationGameID = "a861f0dc-3e2e-4fe9-b487-33194af75b68";
export const nativeAnimationEngineGame = `motion-levels-games:${nativeAnimationGameID}`;
const screensaverThumbnail = publicAssetURL("motion-levels-icon.webp");

function animationProductIdentity(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/^motion-levels-games:/u, "");
}

export function isNativeAnimationProduct(value: string): boolean {
  return [nativeAnimationGameID, "animations", "salvapantallas", "ambient-animations"].includes(animationProductIdentity(value));
}

export function screensaverCard(): GameCard {
  return {
    id: "salvapantallas",
    label: "Salvapantallas",
    category: "attract",
    color: "#36d9ff",
    players: "Todos",
    difficulty: "Ambiente",
    duration: "Bucle",
    mode: "Rotación",
    audio: "Suave",
    description: "Rota automáticamente las animaciones de Motion Levels cuando la pista está en espera.",
    rules: ["La pista rota las animaciones sin cortes.", "Pisa la pista para crear ondas y destellos."],
    engineGame: nativeAnimationEngineGame,
    thumbnailSrc: screensaverThumbnail,
    thumbnailSrcs: [screensaverThumbnail],
    previewSrc: screensaverThumbnail,
    previewSrcs: [screensaverThumbnail],
    featured: false,
    minPlayers: 1,
    maxPlayers: 8,
    allowAnyPlayers: true,
    sourceKind: "motion_levels_games",
    sourceRevision: bundledGamesSourceRevision(),
    sourceGameId: nativeAnimationGameID,
  };
}

/**
 * The native animation library is part of the games bundle. Keep it
 * available regardless of the platform catalog response; a successful
 * platform catalog may add editor-published animation presentations.
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
      engineGame: nativeAnimationEngineGame,
      animationID: animation.id,
      previewRevisionHash: options.sourceRevision ?? bundledGamesSourceRevision(),
      ...media,
      featured: false,
      minPlayers: 1,
      maxPlayers: 1,
      allowAnyPlayers: true,
      sourceKind: "motion_levels_games",
      sourceRevision: options.sourceRevision ?? bundledGamesSourceRevision(),
      sourceGameId: nativeAnimationGameID,
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
        engineGame: nativeAnimationEngineGame,
        animationID: levelID,
        previewAnimation: media ? undefined : `animation-${levelID}`,
        previewRevisionHash,
        ...media,
        featured: false,
        minPlayers: 1,
        maxPlayers: 1,
        allowAnyPlayers: true,
        sourceKind: "motion_levels_games",
        sourceRevision: bundledGamesSourceRevision(),
        sourceGameId: nativeAnimationGameID,
      };
    }))
    .filter((game) => game.id !== "animation-");
}

/**
 * Build the complete Ambiente category. Published platform presentations take
 * precedence over their native card, while the immutable native library is
 * always retained and the idle screensaver remains the first card.
 */
export function ambientAnimationCards(
  catalog: PlatformGameCatalogEntry[] | null,
  options: { menuLocation?: PlayerMenuLocation; sourceRevision?: string } = {},
): GameCard[] {
  const cards = [
    screensaverCard(),
    ...platformAnimationCards(catalog),
    ...nativeAnimationCards(options),
  ];
  return [...new Map(cards.map((card) => [card.id, card])).values()];
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
