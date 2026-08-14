export const gameMediaSchema = "motion-levels-game-media-v1";
export const gameMediaPreviewStillFrameIndex = 4;

export const gameMediaAssetSpecs = Object.freeze({
  thumbnailSmall: Object.freeze({
    width: 256,
    height: 128,
    mimeType: "image/webp",
    animated: false,
    fileSuffix: "thumbnail-small.webp"
  }),
  thumbnail: Object.freeze({
    width: 1_024,
    height: 512,
    mimeType: "image/webp",
    animated: false,
    fileSuffix: "thumbnail.webp"
  }),
  animation: Object.freeze({
    width: 512,
    height: 256,
    mimeType: "image/webp",
    animated: true,
    fileSuffix: "preview.webp"
  }),
  playerDisplay: Object.freeze({
    width: 1_280,
    height: 720,
    mimeType: "image/webp",
    animated: false,
    fileSuffix: "player-display.webp"
  }),
  playerDisplayAnimation: Object.freeze({
    width: 640,
    height: 360,
    mimeType: "image/webp",
    animated: true,
    fileSuffix: "player-display-animation.webp"
  })
} as const);

export type GameMediaAssetKind = keyof typeof gameMediaAssetSpecs;
export type FloorGameMediaAssetKind = "thumbnailSmall" | "thumbnail" | "animation";
export type PlayerDisplayMediaAssetKind = "playerDisplay" | "playerDisplayAnimation";

export type GameMediaReferences = Readonly<Record<GameMediaAssetKind, string>>;
export type GameMediaFileNames = Readonly<Record<GameMediaAssetKind, string>>;

export function mediaAssetFileName(mediaId: string, kind: GameMediaAssetKind): string {
  const id = normalizeMediaId(mediaId);
  return `${id}-${gameMediaAssetSpecs[kind].fileSuffix}`;
}

export function gameMediaFileNames(gameId: string): GameMediaFileNames {
  return mapGameMediaAssets((kind) => mediaAssetFileName(gameId, kind));
}

export function gameMediaReferences(gameId: string): GameMediaReferences {
  const id = normalizeMediaId(gameId);
  const root = `media/${id}`;
  return mapGameMediaAssets((kind) => `${root}/${mediaAssetFileName(id, kind)}`);
}

export function gameMediaMetadataReference(gameId: string): string {
  return `media/${normalizeMediaId(gameId)}/metadata.json`;
}

/** Resolve a bundle-relative media reference from the bundle root URL. */
export function mediaReferenceURL(reference: string, bundleRootURL: string | URL): string {
  const normalizedReference = normalizeMediaReference(reference);
  const root = new URL(bundleRootURL);
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  return new URL(normalizedReference, root).toString();
}

export function gameMediaURL(
  gameId: string,
  kind: GameMediaAssetKind,
  bundleRootURL: string | URL
): string {
  return mediaReferenceURL(gameMediaReferences(gameId)[kind], bundleRootURL);
}

export function fileNameFromMediaReference(reference: string): string {
  const normalizedReference = normalizeMediaReference(reference);
  const fileName = normalizedReference.split("/").at(-1);
  if (!fileName) throw new Error(`Invalid media reference: ${reference}`);
  return fileName;
}

export function normalizeMediaId(value: string): string {
  const id = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new Error(`Invalid media id: ${value}`);
  }
  return id;
}

function normalizeMediaReference(value: string): string {
  const reference = String(value ?? "").trim();
  if (!/^media\/[a-z0-9][a-z0-9/-]*\.[a-z0-9]+$/u.test(reference) || reference.includes("//")) {
    throw new Error(`Invalid bundle media reference: ${value}`);
  }
  return reference;
}

function mapGameMediaAssets<T>(map: (kind: GameMediaAssetKind) => T): Readonly<Record<GameMediaAssetKind, T>> {
  return Object.freeze({
    thumbnailSmall: map("thumbnailSmall"),
    thumbnail: map("thumbnail"),
    animation: map("animation"),
    playerDisplay: map("playerDisplay"),
    playerDisplayAnimation: map("playerDisplayAnimation")
  });
}
