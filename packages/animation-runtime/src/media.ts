import type { NativeAnimation, PressurePoint } from "./core.ts";

export const animationMediaSchema = "motion-levels-animation-media-v1";

export const animationPreviewRecipe = Object.freeze({
  seed: 137,
  captureStartMillis: 800,
  frameCount: 24,
  frameIntervalMillis: 100,
  stillFrameIndex: 4,
  pressure: Object.freeze({ x: 8, y: 16, startedAtMillis: 1_200 }) satisfies PressurePoint
});

export type AnimationMediaReferences = Readonly<{
  thumbnailSmall: string;
  thumbnail: string;
  animation: string;
}>;

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
  const id = normalizeAnimationMediaId(animationId);
  const root = `media/animations/${id}`;
  return Object.freeze({
    thumbnailSmall: `${root}/${id}-thumbnail-small.webp`,
    thumbnail: `${root}/${id}-thumbnail.webp`,
    animation: `${root}/${id}-preview.webp`
  });
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

export function animationMediaURL(animationId: string, kind: AnimationMediaKind, appBaseURL: string | URL): string {
  const reference = animationMediaReferences(animationId)[kind];
  return new URL(`../${reference}`, appBaseURL).toString();
}

function normalizeAnimationMediaId(value: string): string {
  const id = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new Error(`Invalid animation media id: ${value}`);
  }
  return id;
}
