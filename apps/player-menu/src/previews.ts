import { platformBaseURL, type PlatformGameCatalogEntry } from "./api.ts";
import type { DifficultyID, GameCard } from "./catalog.ts";

type CatalogPreviewMediaFields = Pick<
  PlatformGameCatalogEntry,
  "catalog_preview_url" | "catalog_thumbnail_small_url" | "catalog_thumbnail_url"
>;

export function levelHasPreviewMedia(level?: NonNullable<GameCard["levels"]>[number]): boolean {
  return Boolean(level?.previewByDifficulty || level?.previewSrc || level?.previewSrcs?.length || level?.thumbnailSrc || level?.thumbnailSrcs?.length);
}

export function levelThumbnailSrc(level: NonNullable<GameCard["levels"]>[number] | undefined, game: GameCard): string | undefined {
  if (!level) return gameThumbnailSrc(game);
  return level.thumbnailSrc
    || level.thumbnailSrcs?.[0]
    || level.previewByDifficulty?.medium
    || level.previewSrc
    || level.previewSrcs?.[0];
}

export function levelThumbnailSrcs(level: NonNullable<GameCard["levels"]>[number] | undefined, game: GameCard): string[] {
  if (!level) return gameThumbnailSrcs(game);
  const thumbnails = uniquePreviewSources([
    level.thumbnailSrc,
    ...(level.thumbnailSrcs || []),
  ]);
  if (thumbnails.length) return thumbnails;
  return uniquePreviewSources([
    level.previewByDifficulty?.medium,
    level.previewSrc,
    ...(level.previewSrcs || []),
  ]);
}

export function levelPreviewSrcs(game: GameCard, level: NonNullable<GameCard["levels"]>[number] | undefined, difficulty: DifficultyID): string[] {
  if (!level) return uniquePreviewSources([game.previewSrc, game.thumbnailSrc]);
  return uniquePreviewSources([level.previewByDifficulty?.[difficulty], level.previewSrc, ...(level.previewSrcs || []), level.thumbnailSrc, ...(level.thumbnailSrcs || [])]);
}

export function gameThumbnailSrc(game: GameCard): string | undefined {
  return game.thumbnailSrc || game.previewSrc;
}

export function gameThumbnailSrcs(game: GameCard): string[] {
  const thumbnails = uniquePreviewSources([game.thumbnailSrc, ...(game.thumbnailSrcs || [])]);
  if (thumbnails.length) return thumbnails;
  return uniquePreviewSources([game.previewSrc, ...(game.previewSrcs || [])]);
}

export function gamePreviewSrcs(game: GameCard): string[] {
  return uniquePreviewSources([game.previewSrc, ...(game.previewSrcs || []), ...(game.thumbnailSrcs || []), game.thumbnailSrc]);
}

export function richPreviewCandidates(
  posterCandidates: string[],
  richCandidates: Array<string | undefined>,
): string[] {
  return uniquePreviewSources(richCandidates).filter((candidate) => !posterCandidates.includes(candidate));
}

export function levelPreviewSrc(game: GameCard, level: NonNullable<GameCard["levels"]>[number] | undefined, difficulty: DifficultyID): string | undefined {
  if (!level) return game.previewSrc || game.thumbnailSrc;
  return level.previewByDifficulty?.[difficulty] || level.previewSrc || level.previewSrcs?.[0] || level.thumbnailSrc || level.thumbnailSrcs?.[0];
}

export function partyPreviewGridSize(count: number): number {
  if (count <= 1) return 1;
  return Math.ceil(Math.sqrt(count));
}

export function isMotionLevelsLogoSrc(src: string | undefined): boolean {
  return Boolean(src && /(?:^|\/)motion-levels-icon\.(?:webp|png)(?:$|[?#])/i.test(src));
}

export function isManualCatalogAssetRef(value: string): boolean {
  return /\/api\/game-catalog\/manual-assets\/[^/?#]+\/[^/?#]+\/(?:thumbnail\.png|preview\.gif)(?=$|[?#])/i.test(value);
}

export function webpPreviewRef(value: string): string {
  if (isManualCatalogAssetRef(value)) return value;
  return value.replace(/^preview:/, "").replace(/\.(?:gif|png|webp)(?=($|[?#]))/i, ".webp");
}

export function platformAssetURL(pathname: string): string {
  const platformURL = platformBaseURL();
  if (!platformURL) return pathname;
  return `${platformURL.replace(/\/$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function catalogDirectAssetSrc(ref: string | undefined): string | undefined {
  const clean = String(ref || "").trim();
  if (!clean) return undefined;
  if (/^data:image\/gif/i.test(clean)) return undefined;
  if (/^(?:https?:|blob:)/i.test(clean)) return webpPreviewRef(clean);
  if (/^data:/i.test(clean)) return clean;
  if (clean.startsWith("/")) return platformAssetURL(webpPreviewRef(clean));
  return undefined;
}

export function catalogThumbnailSrc(ref: string | undefined): string | undefined {
  return catalogDirectAssetSrc(ref);
}

export function uniquePreviewSources(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function catalogThumbnailMediaSrcs(entry: CatalogPreviewMediaFields, _fallback?: GameCard | undefined): string[] {
  return uniquePreviewSources([
    catalogDirectAssetSrc(entry.catalog_thumbnail_small_url || entry.catalog_thumbnail_url || entry.catalog_preview_url),
  ]);
}

export function catalogPreviewMediaSrcs(entry: CatalogPreviewMediaFields, _fallback?: GameCard | undefined, _thumbnailSrcs: string[] = []): string[] {
  return uniquePreviewSources([
    catalogDirectAssetSrc(entry.catalog_preview_url || entry.catalog_thumbnail_url || entry.catalog_thumbnail_small_url),
  ]);
}
