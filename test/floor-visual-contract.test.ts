import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const floorPreviewSource = await readFile(
  new URL("../packages/display-kit/src/floor-preview.tsx", import.meta.url),
  "utf8"
);
const styleSources = await Promise.all([
  readFile(new URL("../packages/display-kit/src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../apps/playground/src/styles.css", import.meta.url), "utf8")
]);

test("floor occupancy is semantic and cannot create persistent decoration", () => {
  assert.match(floorPreviewSource, /className: "ml-floor-tile"/);
  assert.match(floorPreviewSource, /aria-pressed=\{occupied\}/);
  assert.doesNotMatch(floorPreviewSource, /data-active|ml-floor-tile-pressed/);

  for (const styles of styleSources) {
    assert.doesNotMatch(
      styles,
      /(?:ml-floor-tile-pressed|\.ml-floor-tile[^{]*aria-pressed|aria-pressed[^{]*\.ml-floor-tile)/,
      "only the game frame, real hover, and visible keyboard focus may decorate floor tiles"
    );
  }
});
