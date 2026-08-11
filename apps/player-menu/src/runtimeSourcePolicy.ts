export function isSupportedRuntimeSourceFromProducts(
  sourceKind: string | undefined,
  sourceGameId: string | undefined,
  publishedLevelProductIds: ReadonlySet<string>,
): boolean {
  if (sourceKind === "motion_levels_games") return true;
  return sourceKind === "platform_levels"
    && publishedLevelProductIds.has(String(sourceGameId ?? "").trim().toLowerCase());
}
