export function isSupportedRuntimeSourceFromProducts(
  sourceKind: string | undefined,
  sourceGameId: string | undefined,
  publishedLevelProductIds: ReadonlySet<string>,
): boolean {
  if (sourceKind === "motion_levels_games") return true;
  return sourceKind === "platform_levels"
    && publishedLevelProductIds.has(String(sourceGameId ?? "").trim().toLowerCase());
}

export function catalogSourceMatchesBundledRuntime(
  sourceKind: string | undefined,
  sourceRevision: string | undefined,
  bundledRevision: string,
  hasBundledProduct: boolean,
): boolean {
  if (sourceKind !== "motion_levels_games" && sourceKind !== "platform_levels") return false;
  if (!hasBundledProduct) return false;
  const catalogRevision = String(sourceRevision ?? "").trim();
  return catalogRevision === "" || catalogRevision === String(bundledRevision ?? "").trim();
}
