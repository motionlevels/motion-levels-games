import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nativeAnimationMediaSources } from "../src/animationCatalog.ts";
import { drawFloorCanvas } from "../src/floorView.tsx";
import {
  floorPreviewMediaSpec,
  gameBundleMediaSources,
  resolveBundleRootURL,
  revisionedBundleMediaURL,
} from "../src/bundleMedia.ts";

describe("player-menu bundle media", () => {
  it("resolves the bundle root for every supported menu mount", () => {
    assert.equal(
      resolveBundleRootURL("https://venue.test/menu/?session=1").toString(),
      "https://venue.test/games/",
    );
    assert.equal(
      resolveBundleRootURL("https://platform.test/gateways/motionlevels-1/menu/").toString(),
      "https://platform.test/gateways/motionlevels-1/games/",
    );
    assert.equal(
      resolveBundleRootURL("https://venue.test/games/menu/index.html").toString(),
      "https://venue.test/games/",
    );
    assert.equal(
      resolveBundleRootURL("https://venue.test/games/0123456789abcdef/menu/index.html").toString(),
      "https://venue.test/games/0123456789abcdef/",
    );
  });

  it("keeps an embedded development menu relative to its host app", () => {
    assert.equal(
      resolveBundleRootURL("https://platform.test/games/play/player-menu/?embed=playground").toString(),
      "https://platform.test/games/",
    );
    assert.equal(resolveBundleRootURL("http://localhost:4104/player-menu/").toString(), "http://localhost:4104/");
    assert.equal(
      revisionedBundleMediaURL(
        "media/demo-game/demo-game-preview.webp",
        "0123456789abcdef",
        "https://platform.test/games/play/player-menu/?embed=playground",
      ),
      "https://platform.test/games/media/demo-game/demo-game-preview.webp?revision=0123456789abcdef",
    );
  });

  it("builds canonical, revisioned game media URLs", () => {
    const sources = gameBundleMediaSources(
      "demo-game",
      "0123456789abcdef",
      "https://venue.test/menu/",
    );

    assert.deepEqual(sources, {
      thumbnailSmall: "https://venue.test/games/0123456789abcdef/media/demo-game/demo-game-thumbnail-small.webp?revision=0123456789abcdef",
      thumbnail: "https://venue.test/games/0123456789abcdef/media/demo-game/demo-game-thumbnail.webp?revision=0123456789abcdef",
      animation: "https://venue.test/games/0123456789abcdef/media/demo-game/demo-game-preview.webp?revision=0123456789abcdef",
    });
    assert.deepEqual(
      { width: floorPreviewMediaSpec.width, height: floorPreviewMediaSpec.height },
      { width: 512, height: 256 },
    );
  });

  it("uses the same bundle root and revision for native animation media", () => {
    const media = nativeAnimationMediaSources("aurora", {
      menuLocation: "https://platform.test/gateways/motionlevels-1/menu/",
      sourceRevision: "games-revision",
    });

    assert.equal(
      media?.thumbnailSrc,
      "https://platform.test/gateways/motionlevels-1/games/games-revision/media/animations/aurora/aurora-thumbnail-small.webp?revision=games-revision",
    );
    assert.equal(
      media?.previewSrc,
      "https://platform.test/gateways/motionlevels-1/games/games-revision/media/animations/aurora/aurora-preview.webp?revision=games-revision",
    );

    const alreadyRevisioned = gameBundleMediaSources(
      "demo-game",
      "0123456789abcdef",
      "https://venue.test/games/0123456789abcdef/menu/",
    );
    assert.equal(
      alreadyRevisioned.thumbnail,
      "https://venue.test/games/0123456789abcdef/media/demo-game/demo-game-thumbnail.webp?revision=0123456789abcdef",
    );
  });

  it("draws a gapped landscape floor at the canonical 512x256 size", () => {
    const fillRects: number[][] = [];
    const context = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect: (...values: number[]) => fillRects.push(values),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;

    drawFloorCanvas({
      canvas,
      displayCols: 32,
      displayRows: 16,
      displayCells: [{ x: 0, y: 0, color: "#fff" }],
      tileSize: 14,
      gapSize: 2,
      symmetricEdgeGaps: true,
    });

    assert.equal(canvas.width, 512);
    assert.equal(canvas.height, 256);
    assert.deepEqual(fillRects[1], [1, 1, 14, 14]);
  });

  it("rejects unrevisioned and non-bundle media", () => {
    assert.throws(() => revisionedBundleMediaURL("media/demo/demo-preview.webp", ""));
    assert.throws(() => revisionedBundleMediaURL("../demo-preview.webp", "revision"));
  });
});
