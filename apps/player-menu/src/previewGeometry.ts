/**
 * Return the width that fits a preview's real aspect ratio inside the
 * container's available height.
 *
 * Preview media can be rotated independently from the physical floor. Using
 * the rotation angle to guess whether the width should be halved or doubled
 * makes native landscape canvases collapse to tiny centred thumbnails. The
 * rendered media dimensions are the source of truth instead.
 */
export function previewWidthLimitedByHeight(aspectRatio: number, fallbackInset: string): string {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error(`Preview aspect ratio must be positive and finite: ${aspectRatio}`);
  }
  return `calc((100cqh - var(--preview-board-height-inset, ${fallbackInset})) * ${Number(aspectRatio.toFixed(6))})`;
}
