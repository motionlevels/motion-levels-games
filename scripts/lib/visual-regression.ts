export type VisualDiffStats = Readonly<{
  differentPixels: number;
  totalPixels: number;
  meanChannelDelta: number;
}>;

export type VisualRegressionThresholds = Readonly<{
  maxDifferentPixelRatio: number;
  maxMeanChannelDelta: number;
}>;

export type VisualRegressionEvaluation = Readonly<{
  passed: boolean;
  differentPixelRatio: number;
  failures: readonly string[];
}>;

export const JUGAR_3D_VISUAL_THRESHOLDS: VisualRegressionThresholds = Object.freeze({
  // Captures are compared after deterministic 8x downsampling with a
  // per-pixel RGB threshold. This tolerates GPU edge rasterisation while
  // still failing missing agents, black floors, wrong cameras, and bad poses.
  maxDifferentPixelRatio: 0.035,
  maxMeanChannelDelta: 4
});

export function evaluateVisualRegression(
  stats: VisualDiffStats,
  thresholds: VisualRegressionThresholds = JUGAR_3D_VISUAL_THRESHOLDS
): VisualRegressionEvaluation {
  assertNonNegativeInteger(stats.differentPixels, "differentPixels");
  if (!Number.isInteger(stats.totalPixels) || stats.totalPixels <= 0) {
    throw new Error("visual diff totalPixels must be a positive integer");
  }
  if (stats.differentPixels > stats.totalPixels) {
    throw new Error("visual diff differentPixels cannot exceed totalPixels");
  }
  if (!Number.isFinite(stats.meanChannelDelta) || stats.meanChannelDelta < 0) {
    throw new Error("visual diff meanChannelDelta must be finite and non-negative");
  }
  if (!Number.isFinite(thresholds.maxDifferentPixelRatio)
    || thresholds.maxDifferentPixelRatio < 0
    || thresholds.maxDifferentPixelRatio > 1) {
    throw new Error("visual diff maxDifferentPixelRatio must be between zero and one");
  }
  if (!Number.isFinite(thresholds.maxMeanChannelDelta) || thresholds.maxMeanChannelDelta < 0) {
    throw new Error("visual diff maxMeanChannelDelta must be finite and non-negative");
  }

  const differentPixelRatio = stats.differentPixels / stats.totalPixels;
  const failures: string[] = [];
  if (differentPixelRatio > thresholds.maxDifferentPixelRatio) {
    failures.push(
      `different pixel ratio ${formatPercent(differentPixelRatio)} exceeds ${formatPercent(thresholds.maxDifferentPixelRatio)}`
    );
  }
  if (stats.meanChannelDelta > thresholds.maxMeanChannelDelta) {
    failures.push(
      `mean RGB delta ${stats.meanChannelDelta.toFixed(3)} exceeds ${thresholds.maxMeanChannelDelta.toFixed(3)}`
    );
  }
  return Object.freeze({
    passed: failures.length === 0,
    differentPixelRatio,
    failures: Object.freeze(failures)
  });
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`visual diff ${label} must be a non-negative integer`);
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}
