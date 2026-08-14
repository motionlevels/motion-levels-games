import {
  gameMediaPreviewStillFrameIndex,
  mediaAssetFileName,
  mediaReferenceURL,
  normalizeMediaId,
  type FloorGameMediaAssetKind,
  type GameMediaReferences
} from "@motion-levels-games/game-sdk";
import type { NativeAnimation, PressurePoint } from "./core.ts";

export const animationMediaSchema = "motion-levels-animation-media-v1";

export const animationPreviewRecipe = Object.freeze({
  seed: 137,
  captureStartMillis: 800,
  frameCount: 24,
  frameIntervalMillis: 100,
  stillFrameIndex: gameMediaPreviewStillFrameIndex,
  pressure: Object.freeze({ x: 8, y: 16, startedAtMillis: 1_200 }) satisfies PressurePoint
});

export type AnimationMediaReferences = Readonly<Pick<GameMediaReferences, FloorGameMediaAssetKind>>;

export type AnimationMediaKind = keyof AnimationMediaReferences;

export type AnimationMediaCatalogEntry = Readonly<{
  id: string;
  label: string;
  description: string;
  category: NativeAnimation["category"];
  durationMillis: number;
  palette: NativeAnimation["palette"];
  tags: NativeAnimation["tags"];
  media: AnimationMediaReferences;
}>;

export function animationMediaReferences(animationId: string): AnimationMediaReferences {
  const id = normalizeMediaId(animationId);
  const root = `media/animations/${id}`;
  return Object.freeze({
    thumbnailSmall: `${root}/${mediaAssetFileName(id, "thumbnailSmall")}`,
    thumbnail: `${root}/${mediaAssetFileName(id, "thumbnail")}`,
    animation: `${root}/${mediaAssetFileName(id, "animation")}`
  });
}

export function animationMediaMetadataReference(animationId: string): string {
  return `media/animations/${normalizeMediaId(animationId)}/metadata.json`;
}

export function animationMediaCatalogEntry(animation: NativeAnimation): AnimationMediaCatalogEntry {
  return Object.freeze({
    id: animation.id,
    label: animation.label,
    description: animation.description,
    category: animation.category,
    durationMillis: animation.durationMillis,
    palette: animation.palette,
    tags: animation.tags,
    media: animationMediaReferences(animation.id)
  });
}

export function animationMediaURL(animationId: string, kind: AnimationMediaKind, bundleRootURL: string | URL): string {
  const reference = animationMediaReferences(animationId)[kind];
  return mediaReferenceURL(reference, bundleRootURL);
}
