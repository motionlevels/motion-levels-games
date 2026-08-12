export const animationContentSchema = "motion-levels-animation-content-v1";

export type AnimationRuntimeContent = Readonly<{
  schema: typeof animationContentSchema;
  contentRevision: string;
  selectedAnimationId?: string;
  rotationIds: readonly string[];
  rotationSeconds?: number;
}>;

export function normalizeAnimationRuntimeContent(value: unknown): AnimationRuntimeContent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const content = value as Record<string, unknown>;
  if (content.schema !== animationContentSchema) return undefined;

  const selectedAnimationId = typeof content.selectedAnimationId === "string"
    ? normalizeId(content.selectedAnimationId)
    : undefined;
  const rotationIds = Array.isArray(content.rotationIds)
    ? [...new Set(content.rotationIds
      .filter((id): id is string => typeof id === "string")
      .map(normalizeId)
      .filter(Boolean))].slice(0, 100)
    : [];
  const rotationSeconds = typeof content.rotationSeconds === "number" && Number.isFinite(content.rotationSeconds)
    ? Math.min(120, Math.max(5, Math.round(content.rotationSeconds)))
    : undefined;

  return Object.freeze({
    schema: animationContentSchema,
    contentRevision: String(content.contentRevision ?? "unversioned").slice(0, 160),
    ...(selectedAnimationId ? { selectedAnimationId } : {}),
    rotationIds: Object.freeze(rotationIds),
    ...(rotationSeconds === undefined ? {} : { rotationSeconds })
  });
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
