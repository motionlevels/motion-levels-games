import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlatformGameCatalogEntry } from "../src/api.ts";
import type { GameCard } from "../src/catalog.ts";
import {
  catalogDirectAssetSrc,
  catalogPreviewMediaSrcs,
  catalogThumbnailMediaSrcs,
  gamePreviewSrcs,
  gameThumbnailSrc,
  gameThumbnailSrcs,
  isManualCatalogAssetRef,
  isMotionLevelsLogoSrc,
  levelHasPreviewMedia,
  levelPreviewSrc,
  levelPreviewSrcs,
  levelThumbnailSrc,
  levelThumbnailSrcs,
  partyPreviewGridSize,
  richPreviewCandidates,
  uniquePreviewSources,
  webpPreviewRef,
} from "../src/previews.ts";

type Level = NonNullable<GameCard["levels"]>[number];

function gameCard(patch: Partial<GameCard> = {}): GameCard {
  return {
    id: "demo",
    label: "Demo",
    category: "individual",
    color: "#ffffff",
    players: "1",
    difficulty: "",
    duration: "",
    mode: "",
    audio: "",
    description: "",
    rules: [],
    ...patch,
  };
}

describe("preview source utilities", () => {
  it("rewrites animated/legacy refs to webp", () => {
    assert.equal(webpPreviewRef("preview:foo.png"), "foo.webp");
    assert.equal(webpPreviewRef("foo.gif?v=2"), "foo.webp?v=2");
    assert.equal(webpPreviewRef("foo.webp#x"), "foo.webp#x");
    assert.equal(webpPreviewRef("foo.jpg"), "foo.jpg");
    assert.equal(webpPreviewRef("/api/game-catalog/manual-assets/demo/v1/thumbnail.png?v=2"), "/api/game-catalog/manual-assets/demo/v1/thumbnail.png?v=2");
    assert.equal(webpPreviewRef("/api/game-catalog/manual-assets/demo/v1/preview.gif#x"), "/api/game-catalog/manual-assets/demo/v1/preview.gif#x");
    assert.equal(isManualCatalogAssetRef("/api/game-catalog/manual-assets/demo/v1/thumbnail.png"), true);
    assert.equal(isManualCatalogAssetRef("/api/game-catalog/manual-assets/demo/v1/preview.gif"), true);
  });

  it("dedupes and drops empty preview sources", () => {
    assert.deepEqual(uniquePreviewSources(["a", undefined, "a", "", "b"]), ["a", "b"]);
  });

  it("computes a square-ish party preview grid", () => {
    assert.equal(partyPreviewGridSize(1), 1);
    assert.equal(partyPreviewGridSize(2), 2);
    assert.equal(partyPreviewGridSize(4), 2);
    assert.equal(partyPreviewGridSize(5), 3);
  });

  it("detects the bundled logo source", () => {
    assert.equal(isMotionLevelsLogoSrc("/assets/motion-levels-icon.webp"), true);
    assert.equal(isMotionLevelsLogoSrc("motion-levels-icon.png?v=1"), true);
    assert.equal(isMotionLevelsLogoSrc("/assets/other.webp"), false);
    assert.equal(isMotionLevelsLogoSrc(undefined), false);
  });
});

describe("game and level preview resolution", () => {
  it("reports whether a level carries its own preview media", () => {
    assert.equal(levelHasPreviewMedia(undefined), false);
    assert.equal(levelHasPreviewMedia({ id: "l1", label: "L1", description: "" } as Level), false);
    assert.equal(levelHasPreviewMedia({ id: "l1", label: "L1", description: "", thumbnailSrc: "x.webp" } as Level), true);
  });

  it("prefers game thumbnail then preview", () => {
    assert.equal(gameThumbnailSrc(gameCard({ thumbnailSrc: "t.webp", previewSrc: "p.webp" })), "t.webp");
    assert.equal(gameThumbnailSrc(gameCard({ previewSrc: "p.webp" })), "p.webp");
    assert.equal(gameThumbnailSrc(gameCard()), undefined);
  });

  it("collects ordered, de-duplicated game source lists", () => {
    const game = gameCard({ previewSrc: "p.webp", previewSrcs: ["p.webp", "p2.webp"], thumbnailSrc: "t.webp", thumbnailSrcs: ["t.webp"] });
    assert.deepEqual(gameThumbnailSrcs(game), ["t.webp"]);
    assert.deepEqual(gamePreviewSrcs(game), ["p.webp", "p2.webp", "t.webp"]);
  });

  it("keeps animated preview candidates out of posters when a thumbnail exists", () => {
    const game = gameCard({
      thumbnailSrc: "thumbnail.webp",
      thumbnailSrcs: ["thumbnail.webp"],
      previewSrc: "preview.webp",
      previewSrcs: ["preview.webp"],
    });
    const posterCandidates = gameThumbnailSrcs(game);
    const richCandidates = richPreviewCandidates(posterCandidates, gamePreviewSrcs(game));

    assert.deepEqual(posterCandidates, ["thumbnail.webp"]);
    assert.deepEqual(richCandidates, ["preview.webp"]);
  });

  it("uses preview media as the poster only when no thumbnail exists", () => {
    const game = gameCard({ previewSrc: "preview.webp", previewSrcs: ["preview.webp", "preview-2.webp"] });

    assert.equal(gameThumbnailSrc(game), "preview.webp");
    assert.deepEqual(gameThumbnailSrcs(game), ["preview.webp", "preview-2.webp"]);
  });

  it("falls back to game media when no level is selected", () => {
    const game = gameCard({ previewSrc: "p.webp", thumbnailSrc: "t.webp" });
    assert.equal(levelPreviewSrc(game, undefined, "medium"), "p.webp");
    assert.equal(levelThumbnailSrc(undefined, game), "t.webp");
    assert.deepEqual(levelThumbnailSrcs(undefined, game), ["t.webp"]);
  });

  it("keeps level thumbnails ahead of richer preview media", () => {
    const level = {
      id: "l1",
      label: "L1",
      description: "",
      thumbnailSrc: "thumb.webp",
      thumbnailSrcs: ["thumb.webp", "thumb-2.webp"],
      previewByDifficulty: { medium: "medium-preview.webp" },
      previewSrc: "preview.webp",
      previewSrcs: ["preview.webp", "preview-2.webp"],
    } as Level;
    const game = gameCard();

    assert.equal(levelThumbnailSrc(level, game), "thumb.webp");
    assert.deepEqual(levelThumbnailSrcs(level, game), [
      "thumb.webp",
      "thumb-2.webp",
    ]);
    assert.deepEqual(levelThumbnailSrcs({
      ...level,
      thumbnailSrc: undefined,
      thumbnailSrcs: undefined,
    }, game), [
      "medium-preview.webp",
      "preview.webp",
      "preview-2.webp",
    ]);
  });

  it("resolves per-difficulty level previews with fallback chain", () => {
    const level = {
      id: "l1",
      label: "L1",
      description: "",
      previewByDifficulty: { hard: "hard.webp" },
      previewSrc: "base.webp",
      thumbnailSrc: "thumb.webp",
    } as Level;
    const game = gameCard();
    assert.equal(levelPreviewSrc(game, level, "hard"), "hard.webp");
    assert.equal(levelPreviewSrc(game, level, "easy"), "base.webp");
    assert.deepEqual(levelPreviewSrcs(game, level, "hard"), ["hard.webp", "base.webp", "thumb.webp"]);
  });
});

describe("catalog asset sources", () => {
  it("normalizes remote and data refs and rejects unusable ones", () => {
    assert.equal(catalogDirectAssetSrc("https://cdn.test/a.png"), "https://cdn.test/a.webp");
    assert.equal(catalogDirectAssetSrc("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
    assert.equal(catalogDirectAssetSrc("data:image/gif;base64,AAAA"), undefined);
    assert.equal(catalogDirectAssetSrc("  "), undefined);
    assert.equal(catalogDirectAssetSrc("relative/no-slash.png"), undefined);
  });

  it("builds catalog media lists from the platform catalog source", () => {
    const entry = {
      catalog_preview_url: "https://cdn.test/preview.png",
      catalog_thumbnail_url: "https://cdn.test/thumb.png",
    } as unknown as PlatformGameCatalogEntry;
    const fallback = gameCard({ thumbnailSrc: "https://cdn.test/fallback-thumb.webp", previewSrc: "https://cdn.test/fallback-prev.webp" });
    const thumbs = catalogThumbnailMediaSrcs(entry, fallback);
    assert.deepEqual(thumbs, [
      "https://cdn.test/thumb.webp",
    ]);
    const previews = catalogPreviewMediaSrcs(entry, fallback, thumbs);
    assert.deepEqual(previews, ["https://cdn.test/preview.webp"]);
  });
});
