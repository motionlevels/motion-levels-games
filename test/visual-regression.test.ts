import assert from "node:assert/strict";
import test from "node:test";
import {
  JUGAR_3D_VISUAL_THRESHOLDS,
  evaluateVisualRegression
} from "../scripts/lib/visual-regression.ts";

test("visual regression tolerance accepts small rasterisation drift", () => {
  const evaluation = evaluateVisualRegression({
    differentPixels: 900,
    totalPixels: 32_400,
    meanChannelDelta: 2.25
  });
  assert.equal(evaluation.passed, true);
  assert.deepEqual(evaluation.failures, []);
});

test("visual regression tolerance reports structural image failures", () => {
  const evaluation = evaluateVisualRegression({
    differentPixels: 8_100,
    totalPixels: 32_400,
    meanChannelDelta: 31.5
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.failures.length, 2);
  assert.match(evaluation.failures[0] ?? "", /25\.000%.*3\.500%/);
  assert.match(evaluation.failures[1] ?? "", /31\.500.*4\.000/);
});

test("visual regression tolerance rejects invalid measurements", () => {
  assert.throws(
    () => evaluateVisualRegression({ differentPixels: 2, totalPixels: 1, meanChannelDelta: 0 }),
    /cannot exceed/
  );
  assert.throws(
    () => evaluateVisualRegression(
      { differentPixels: 0, totalPixels: 1, meanChannelDelta: 0 },
      { ...JUGAR_3D_VISUAL_THRESHOLDS, maxDifferentPixelRatio: 2 }
    ),
    /between zero and one/
  );
});
