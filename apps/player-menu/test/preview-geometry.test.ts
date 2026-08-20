import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewWidthLimitedByHeight } from "../src/previewGeometry.ts";

describe("preview geometry", () => {
  it("derives a landscape width from the actual 2:1 media aspect ratio", () => {
    assert.equal(
      previewWidthLimitedByHeight(2, "18px"),
      "calc((100cqh - var(--preview-board-height-inset, 18px)) * 2)",
    );
  });

  it("derives a portrait width from the actual 1:2 media aspect ratio", () => {
    assert.equal(
      previewWidthLimitedByHeight(0.5, "14px"),
      "calc((100cqh - var(--preview-board-height-inset, 14px)) * 0.5)",
    );
  });

  it("rejects invalid aspect ratios instead of silently creating a tiny preview", () => {
    assert.throws(() => previewWidthLimitedByHeight(0, "18px"), /positive and finite/u);
    assert.throws(() => previewWidthLimitedByHeight(Number.NaN, "18px"), /positive and finite/u);
  });
});
