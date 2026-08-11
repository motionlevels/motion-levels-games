import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closestSupportedDifficulty,
  platformDifficultyLabel,
  platformLevelSupportedDifficulties,
  estimatedDurationLabel,
  platformDurationLabel,
  platformPlayerBounds,
  platformPlayerConfigVars,
  platformPlayerRangeLabel,
  platformSupportedDifficulties,
  platformSupportsLevels,
  playerBoundsForGame,
  rosterForGame,
  shouldPreferCatalogFallbackPreviewAnimation,
  supportedDifficultiesForGame,
} from "../src/catalogSync.ts";
import { platformAnimationCards } from "../src/animationCatalog.ts";
import { inferPlatformURL } from "../src/api.ts";
import { isSupportedRuntimeSourceFromProducts } from "../src/runtimeSourcePolicy.ts";
import type { PlatformGameCatalogEntry } from "../src/api.ts";
import type { GameCard } from "../src/catalog.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function catalogEntry(patch: Partial<PlatformGameCatalogEntry> = {}): PlatformGameCatalogEntry {
  return {
    id: "catalog-game",
    engine_game: "catalog-game",
    label: "Catalog Game",
    description: "",
    catalog_category: "team",
    catalog_enabled: true,
    catalog_featured: false,
    catalog_color: "#36d9ff",
    catalog_order: 10,
    players_label: "",
    difficulty_label: "",
    duration_label: "",
    estimated_duration_seconds: 0,
    supports_levels: true,
    mode_label: "",
    audio_label: "",
    min_players: 1,
    max_players: 4,
    difficulties: ["easy", "medium", "hard", "expert"],
    default_music_ref: "",
    default_music_volume: 0.16,
    source_kind: "platform_levels",
    source_available: true,
    code_editable: false,
    ...patch,
  };
}

describe("catalog metadata sync", () => {
  it("uses the public platform catalog when the menu runs on a direct venue host", () => {
    assert.equal(inferPlatformURL({
      hostname: "motionlevels-cloud-1",
      origin: "http://motionlevels-cloud-1",
      pathname: "/menu/",
      protocol: "http:",
    }), "https://platform.motionlevels.obis.dev");
    assert.equal(inferPlatformURL({
      hostname: "platform.motionlevels.obis.dev",
      origin: "https://platform.motionlevels.obis.dev",
      pathname: "/gateways/motionlevels-cloud-1/menu/",
      protocol: "https:",
    }), "https://platform.motionlevels.obis.dev");
    assert.equal(inferPlatformURL({
      hostname: "localhost",
      origin: "http://localhost:4103",
      pathname: "/menu/",
      protocol: "http:",
    }), "http://localhost:4103");
  });

  it("uses structured platform player bounds", () => {
    const entry = catalogEntry({ min_players: 2, max_players: 5, players_label: "2-5" });

    assert.deepEqual(platformPlayerBounds(entry), { minPlayers: 2, maxPlayers: 5 });
    assert.equal(platformPlayerRangeLabel(entry), "2-5");
  });

  it("treats explicit allow-any games as roster-flexible without changing legacy bounds", () => {
    const allowAny = catalogEntry({ allow_any_players: true, min_players: 2, max_players: 2, players_label: "2" });
    const legacy = catalogEntry({ min_players: 2, max_players: 2, players_label: "2" });

    assert.equal(platformPlayerRangeLabel(allowAny), "Sin requisito");
    assert.deepEqual(playerBoundsForGame({
      allowAnyPlayers: true,
      category: "arcade",
      id: "allow-any",
      maxPlayers: 2,
      minPlayers: 2,
      players: "Sin requisito",
    }), { minPlayers: 1, maxPlayers: 99 });
    assert.equal(platformPlayerRangeLabel(legacy), "2");
  });

  it("derives ambient player labels from category", () => {
    const entry = catalogEntry({ min_players: 3, max_players: 3, players_label: "Tríos" });

    assert.equal(platformPlayerRangeLabel(entry), "3");
    assert.equal(platformPlayerRangeLabel(catalogEntry({ catalog_category: "attract", min_players: 1, max_players: 1 })), "Todos");
  });

  it("normalizes platform difficulty options and exposes the same label shown in the menu", () => {
    const entry = catalogEntry({ difficulties: ["hard", "medium", "medium", "unknown"] });

    assert.deepEqual(platformSupportedDifficulties(entry), ["medium", "hard"]);
    assert.equal(platformDifficultyLabel(entry), "Media-Difícil");
  });

  it("derives difficulty copy from structured IDs and category", () => {
    const entry = catalogEntry({
      difficulty_label: "1-4 estrellas",
      difficulties: ["easy", "medium", "hard", "expert"],
    });

    assert.equal(platformDifficultyLabel(entry), "Fácil-Experto");
    assert.deepEqual(platformSupportedDifficulties(entry), ["easy", "medium", "hard", "expert"]);
    assert.equal(platformDifficultyLabel(catalogEntry({ catalog_category: "attract", difficulties: ["medium"] })), "Ambiente");
  });

  it("formats estimated duration when no custom duration label is set", () => {
    assert.equal(estimatedDurationLabel(45), "45s");
    assert.equal(estimatedDurationLabel(300), "5 min");
    assert.equal(estimatedDurationLabel(5400), "1h 30 min");
    assert.equal(platformDurationLabel(catalogEntry({ duration_label: "", estimated_duration_seconds: 90 })), "2 min");
    assert.equal(platformDurationLabel(catalogEntry({ duration_label: "Sin límite", estimated_duration_seconds: 0 })), "");
  });

  it("treats support for levels as a catalog-owned flag", () => {
    assert.equal(platformSupportsLevels(catalogEntry({ supports_levels: true })), true);
    assert.equal(platformSupportsLevels(catalogEntry({ supports_levels: false })), false);
  });

  it("uses game-level difficulty support for menu buttons, with level metadata allowed to narrow it", () => {
    const game = { difficulties: ["medium", "hard"] } as Pick<GameCard, "difficulties">;

    assert.deepEqual(supportedDifficultiesForGame(game), ["medium", "hard"]);
    assert.deepEqual(supportedDifficultiesForGame(game, { difficulties: ["hard"] }), ["hard"]);
  });

  it("uses platform level difficulty settings as the supported menu buttons", () => {
    assert.deepEqual(
      platformLevelSupportedDifficulties({
        difficulty: "medium",
        rules: {
          difficulty_settings: {
            easy: { life: 7 },
            medium: { life: 5 },
            hard: { life: 3 },
            expert: { life: 1 },
          },
        },
      }),
      ["easy", "medium", "hard", "expert"],
    );
  });

  it("never lets level metadata re-enable a difficulty disabled in the game catalog", () => {
    const game = { difficulties: ["medium", "hard"] } as Pick<GameCard, "difficulties">;

    assert.deepEqual(supportedDifficultiesForGame(game, { difficulties: ["easy", "medium", "expert"] }), ["medium"]);
    assert.deepEqual(supportedDifficultiesForGame(game, { difficulties: ["easy", "expert"] }), ["medium", "hard"]);
  });

  it("snaps requested difficulty to the closest supported option", () => {
    assert.equal(closestSupportedDifficulty("expert", ["medium", "hard"]), "hard");
    assert.equal(closestSupportedDifficulty("easy", ["medium", "hard"]), "medium");
  });

  it("uses catalog player bounds for launch roster selection even for category-specific games", () => {
    const game = {
      id: "catalog-individual",
      category: "individual",
      minPlayers: 2,
      maxPlayers: 3,
    } as Pick<GameCard, "category" | "engineGame" | "id" | "maxPlayers" | "minPlayers">;
    const players = [
      { active: true, id: 1 },
      { active: true, id: 2 },
      { active: true, id: 3 },
      { active: true, id: 4 },
      { active: false, id: 5 },
    ];

    assert.deepEqual(playerBoundsForGame(game), { minPlayers: 2, maxPlayers: 3 });
    assert.deepEqual(rosterForGame(game, players).map((player) => player.id), [1, 2, 3]);
  });

  it("falls back to eight-player authored duel bounds when catalog metadata is unavailable", () => {
    const game = {
      id: "duel",
      engineGame: "authored-duel",
      category: "versus",
    } as Pick<GameCard, "category" | "engineGame" | "id" | "maxPlayers" | "minPlayers">;

    assert.deepEqual(playerBoundsForGame(game), { minPlayers: 2, maxPlayers: 8 });
  });

  it("does not expose the internal animations storage launcher", () => {
    const catalogSource = fs.readFileSync(path.resolve(__dirname, "../src/catalog.ts"), "utf8");
    const staticGamesSource = catalogSource
      .slice(catalogSource.indexOf("export const games: GameCard[] = ["))
      .split("\n];")[0];

    assert.equal(/id:\s*"animations"/.test(staticGamesSource), false);
    assert.match(staticGamesSource, /id:\s*"salvapantallas"[\s\S]*?engineGame:\s*"salvapantallas"/);
  });

  it("expands published animations into Ambiente cards without drafts", () => {
    const cards = platformAnimationCards([
      catalogEntry({
        id: "animations",
        engine_game: "animations",
        source_kind: "animation",
        catalog_enabled: false,
        default_music_ref: "Motion/canciones/Ambient.mp3",
        revision_hash: "game-rev",
        levels: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            slug: "aurora",
            label: "Aurora",
            description: "Loop suave",
            status: "published",
            settings_hash: "level-rev",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            slug: "draft-loop",
            label: "Draft loop",
            description: "Todavía oculto",
            status: "draft",
            settings_hash: "draft-rev",
          },
        ],
      }),
    ]);

    assert.deepEqual(cards.map((card) => card.id), ["animation-aurora"]);
    assert.equal(cards[0].category, "attract");
    assert.equal(cards[0].engineGame, "animation-aurora");
    assert.equal(cards[0].previewAnimation, "animation-aurora");
    assert.equal(cards[0].previewRevisionHash, "level-rev");
  });

  it("keeps party inside the competitive menu category", () => {
    const catalogSource = fs.readFileSync(path.resolve(__dirname, "../src/catalog.ts"), "utf8");

    assert.equal(/\|\s*"party"/.test(catalogSource), false);
    assert.equal(/id:\s*"party"/.test(catalogSource), false);
    assert.match(catalogSource, /id:\s*"versus"[\s\S]*?label:\s*"Competitivos"/);
  });

  it("keeps the player-facing fallback catalog minimal", () => {
    const catalogSource = fs.readFileSync(path.resolve(__dirname, "../src/catalog.ts"), "utf8");
    const staticGamesSource = catalogSource
      .slice(catalogSource.indexOf("export const games: GameCard[] = ["))
      .split("\n];")[0];

    for (const id of ["memory-lights", "niveles", "temporada1-niveles", "temporada2", "patrones"]) {
      assert.equal(new RegExp(`id:\\s*"${id}"`).test(staticGamesSource), false);
    }
    assert.match(staticGamesSource, /id:\s*"featured-lava"/);
    assert.match(staticGamesSource, /id:\s*"salvapantallas"/);
  });

  it("keeps catalog preview media cheap to decode", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const styleSource = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");

    assert.match(appSource, /decoding="async"/);
    assert.match(appSource, /loading=\{compact \? "lazy" : "eager"\}/);
    assert.match(appSource, /richSrc=\{rich \? game\.previewSrc : undefined\}/);
    assert.match(appSource, /richSrcs=\{rich \? gamePreviewSrcs\(game\) : emptyPreviewSources\}/);
    assert.match(appSource, /promoteAnimation=\{rich\}/);
    assert.match(appSource, /renderPartyPreview\(game, \{ compact: true, rich: selected \|\| active \}\)/);
    assert.match(styleSource, /--preview-board-max-width: min\(78%, 560px\);/);
    assert.match(styleSource, /\.floor-canvas\s*\{[\s\S]*?max-width: var\(--preview-board-max-width\);[\s\S]*?max-height: var\(--preview-board-max-height\);/);
    assert.match(styleSource, /\.party-preview-tile \.preview\s*\{\s*--preview-board-max-height: calc\(100% - 4px\);\s*--preview-board-max-width: calc\(100% - 4px\);/);
  });

  it("can lock the menu app to the fixed TV design viewport for scaled embeds", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../src/main.tsx"), "utf8");
    assert.match(source, /function fixedKioskPreviewViewport\(\)/);
    assert.match(source, /if \(fixedKioskPreviewViewport\(\)\) return 1;/);
    assert.match(source, /get\("kioskViewport"\) === `\$\{kioskDesignWidth\}x\$\{kioskDesignHeight\}`/);
  });

  it("uses revisioned platform preview media for level cards", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const previewsSource = fs.readFileSync(path.resolve(__dirname, "../src/previews.ts"), "utf8");
    const cardThumbnailSources = previewsSource.slice(
      previewsSource.indexOf("function catalogThumbnailMediaSrcs("),
      previewsSource.indexOf("function catalogPreviewMediaSrcs("),
    );
    const levelThumbnailSources = appSource.slice(
      appSource.indexOf("const platformThumbnailSrcs = catalogThumbnailMediaSrcs(lvl);"),
      appSource.indexOf("const hasLevelMedia = platformPreviewSrcs.length > 0 || platformThumbnailSrcs.length > 0;"),
    );

    assert.match(appSource, /const platformThumbnailSrcs = catalogThumbnailMediaSrcs\(lvl\);/);
    assert.match(appSource, /const platformPreviewSrcs = catalogPreviewMediaSrcs\(lvl\);/);
    assert.match(cardThumbnailSources, /entry\.catalog_thumbnail_small_url \|\| entry\.catalog_thumbnail_url \|\| entry\.catalog_preview_url/);
    assert.match(levelThumbnailSources, /catalogThumbnailMediaSrcs\(lvl\)/);
    assert.match(appSource, /ml-player-menu-platform-catalog-v3/);
    assert.doesNotMatch(appSource, /hasLegacyPreviewMediaURL/);
    assert.doesNotMatch(appSource, /isLegacyPreviewMediaURL/);
    assert.match(appSource, /previewRevisionHash: existing\?\.previewRevisionHash \|\| lvl\.settings_hash \|\| lvl\.updated_at/);
    assert.match(appSource, /src=\{levelThumbnailSrc\(level, game\)\}/);
    assert.match(appSource, /richSrc=\{active \? levelPreviewSrc\(game, level, previewDifficulty\) : undefined\}/);
  });

  it("hides future challenge level previews behind a mystery tile", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const styleSource = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");

    assert.match(appSource, /function challengeLevelPreviewRevealed/);
    assert.match(appSource, /if \(levelModeFor\(game, state\) === "free"\) return true;/);
    assert.match(appSource, /if \(active\) return true;/);
    assert.match(appSource, /challengeRunFor\(game, state\)\?\.completedLevels\[levelID\] !== undefined/);
    assert.match(appSource, /const revealPreview = challengeLevelPreviewRevealed\(game, level\.id, menu, active\);/);
    assert.match(appSource, /revealPreview \? \(/);
    assert.match(appSource, /<LevelMysteryPreview \/>/);
    assert.match(appSource, /function LevelMysteryPreview/);
    assert.match(appSource, /<QuestionIcon \/>/);
    assert.match(styleSource, /\.level-mystery-preview\s*\{/);
    assert.match(styleSource, /\.level-mystery-preview__icon\s*\{/);
    assert.match(appSource, /renderPartyPreview\(game, \{ compact: true, rich: selected \|\| active \}\)/);
  });

  it("keeps preview animations configured and uses them when thumbnail media is missing", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const styleSource = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
    const helperSource = appSource.slice(
      appSource.indexOf("function catalogPreviewAnimation("),
      appSource.indexOf("function platformEntryToGameCard("),
    );

    assert.match(helperSource, /if \(configured\) return configured;/);
    assert.match(helperSource, /if \(fallback\?\.previewAnimation\) return fallback\.previewAnimation;/);
    assert.doesNotMatch(helperSource, /hasPlatformMedia/);
    assert.match(appSource, /const mediaWasConfigured = sourceCandidates\.length > 0;/);
    assert.match(appSource, /const mediaUnavailable = mediaWasConfigured && !mediaSrc;/);
    assert.match(appSource, /const showAnimation = Boolean\(\(promotedToAnimation \|\| !mediaSrc\) && anim\);/);
    assert.match(appSource, /const showLogoFallback = !mediaSrc && !showAnimation;/);
    assert.match(appSource, /logoMedia \|\| showLogoFallback \? "logo-preview" : ""/);
    assert.match(appSource, /showAnimation \? \(\s*<FloorPreview anim=\{anim\} orientation="landscape" \/>/);
    assert.match(appSource, /<div className="preview-logo-fallback" aria-hidden="true">[\s\S]*?<img src="\/motion-levels-icon\.webp" alt="" \/>/);
    assert.match(styleSource, /\.game-body\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(54px, max-content\);[\s\S]*?align-items: center;/);
    assert.match(styleSource, /\.game-card-meta\s*\{[\s\S]*?justify-self: end;[\s\S]*?align-self: center;/);
    assert.match(styleSource, /\.game-body h3\s*\{[\s\S]*?line-height: 1\.05;/);
    assert.match(styleSource, /grid-template-columns: minmax\(0, 1fr\) minmax\(76px, max-content\);[\s\S]*?font-size: 28px;/);
  });

  it("prefers authored preview animations for engine games without static preview art", () => {
    const lavaFallback = { previewAnimation: "lava" };

    assert.equal(
      shouldPreferCatalogFallbackPreviewAnimation(
        catalogEntry({
          catalog_preview_url: "/api/game-catalog/previews/lava.webp",
          catalog_thumbnail_url: "/api/game-catalog/previews/lava/revision/thumbnail.webp",
          source_kind: "native",
          supports_levels: false,
        }),
        lavaFallback,
      ),
      true,
    );
    assert.equal(
      shouldPreferCatalogFallbackPreviewAnimation(
        catalogEntry({
          source_kind: "platform_levels",
          supports_levels: true,
        }),
        lavaFallback,
      ),
      false,
    );
    assert.equal(
      shouldPreferCatalogFallbackPreviewAnimation(
        catalogEntry({
          source_kind: "native",
          supports_levels: false,
        }),
        { previewAnimation: "parkour", thumbnailSrc: "/previews/parkour.webp" },
      ),
      false,
    );
  });

  it("uses platform preview media for level games instead of special-casing level previews", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const floorSource = fs.readFileSync(path.resolve(__dirname, "../src/floor.ts"), "utf8");
    const previewsSource = fs.readFileSync(path.resolve(__dirname, "../src/previews.ts"), "utf8");
    const contractsSource = fs.readFileSync(path.resolve(__dirname, "../src/contracts.ts"), "utf8");

    assert.doesNotMatch(appSource, /function isParkourPreviewGame/);
    assert.doesNotMatch(appSource, /forceParkourAnimation/);
    assert.doesNotMatch(appSource, /parkourLevelPreview/);
    assert.doesNotMatch(floorSource, /parkourPreview/);
    assert.doesNotMatch(floorSource, /temporada1Preview/);
    assert.doesNotMatch(floorSource, /temporada1-level-/);
    assert.doesNotMatch(appSource, /const platformThumbnailSrcs = preferFallbackAnimation \? \[\] : uniquePreviewSources/);
    assert.doesNotMatch(appSource, /const platformPreviewSrcs = preferFallbackAnimation \? \[\] : uniquePreviewSources/);
    assert.match(appSource, /const thumbnailSrcs = catalogThumbnailMediaSrcs\(entry\);/);
    assert.match(appSource, /const previewSrcs = catalogPreviewMediaSrcs\(entry\);/);
    assert.match(appSource, /const platformThumbnailSrcs = catalogThumbnailMediaSrcs\(lvl\);/);
    assert.match(appSource, /const platformPreviewSrcs = catalogPreviewMediaSrcs\(lvl\);/);
    assert.match(appSource, /const preferFallbackAnimation = shouldPreferCatalogFallbackPreviewAnimation\(entry, fallback\);/);
    assert.match(appSource, /const previewAnimation = catalogPreviewAnimation\(entry, fallback, engineGame, preferFallbackAnimation\);/);
    assert.match(appSource, /const hasLevelMedia = platformPreviewSrcs\.length > 0 \|\| platformThumbnailSrcs\.length > 0;/);
    assert.match(appSource, /previewAnimation: hasLevelMedia \? undefined : existing\?\.previewAnimation \|\| fallbackLevel\?\.previewAnimation,/);
    assert.match(previewsSource, /function levelHasPreviewMedia\(level\?: NonNullable<GameCard\["levels"\]>\[number\]\): boolean/);
    assert.match(appSource, /function levelFallbackPreviewAnimationID\(game: GameCard, level\?: NonNullable<GameCard\["levels"\]>\[number\]\): string/);
    assert.match(appSource, /if \(levelHasPreviewMedia\(level\)\) return "";/);
    assert.doesNotMatch(appSource, /function levelFallbackPreviewAnim\(/);
    assert.doesNotMatch(appSource, /fallbackAnim=\{levelFallbackPreviewAnim/);
    assert.match(appSource, /animationID=\{levelFallbackPreviewAnimationID\(game, level\)\}/);
    assert.match(appSource, /promoteAnimation=\{active && !levelHasPreviewMedia\(level\)\}/);
    assert.doesNotMatch(floorSource, /const temporada1Level1FrameCells/);
    assert.doesNotMatch(contractsSource, /floorPreview/);
    assert.doesNotMatch(floorSource, /parkour2: parkour/);
  });

  it("rejects retired Go game-source config", () => {
    const entry = catalogEntry({
      game_source: {
        schema: "motion-go-v1",
        kind: "wasm",
        config: {
          vars: [
            { key: "points_to_win", label: "Puntos para ganar", type: "int", default: 7, min: 1, max: 21, player_facing: true },
            { key: "internal_speed", type: "float", default: 1.2 },
            { key: "mode", type: "enum", default: "classic", options: [{ value: "classic", label: "Clásico" }, { value: "turbo" }], player_facing: true },
            { key: "rounds", label: "Rondas", type: "int", default: 3, min: 1, max: 9, playerFacing: true },
            { key: "broken_enum", type: "enum", player_facing: true },
            { key: "", type: "int", player_facing: true },
          ],
        },
      },
    });

    assert.equal(platformPlayerConfigVars(entry), undefined);
    assert.equal(platformPlayerConfigVars(catalogEntry()), undefined);
    assert.equal(platformPlayerConfigVars(catalogEntry({ game_source: { schema: "motion-go-v1", kind: "wasm" } })), undefined);
  });

  it("extracts player-facing config vars from motion-levels-games sources", () => {
    const vars = platformPlayerConfigVars(catalogEntry({
      game_source: {
        schema: "motion-levels-games-v2",
        kind: "typescript",
        config: {
          vars: [
            {
              key: "target_fill_percent",
              label: "Densidad de objetivos",
              description: "Porcentaje del suelo ocupado por objetivos",
              type: "int",
              default: 60,
              min: 30,
              max: 90,
              step: 5,
              player_facing: true,
            },
            { key: "internal_animation_speed", type: "float", default: 1.2, player_facing: false },
          ],
        },
      },
    }));

    assert.deepEqual(vars, [{
      key: "target_fill_percent",
      label: "Densidad de objetivos",
      description: "Porcentaje del suelo ocupado por objetivos",
      type: "int",
      default: 60,
      min: 30,
      max: 90,
      step: 5,
    }]);
    assert.equal(platformPlayerConfigVars(catalogEntry({
      game_source: { schema: "unknown-game-source-v1", config: { vars: [] } },
    })), undefined);
  });

  it("purges retired platform catalog cache keys at boot", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");

    assert.match(appSource, /const retiredStorageKeys = \[/);
    assert.match(appSource, /"ml-player-menu-platform-catalog-v1",/);
    assert.match(appSource, /for \(const key of retiredStorageKeys\) localStorage\.removeItem\(key\);/);
  });

  it("sends player config overrides with the launch request", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");

    assert.match(appSource, /const launchConfig = menuConfigOverridesFor\(launchGame, nextMenu\);/);
    assert.match(appSource, /config: launchConfig,/);
    assert.match(appSource, /playerCount: launchGame\.allowAnyPlayers \? 0 : Math\.max\(1, launchRoster\.length\),/);
    assert.match(appSource, /allowAnyPlayers: launchGame\.allowAnyPlayers === true,/);
    assert.match(appSource, /configVars: platformPlayerConfigVars\(entry\),/);
    assert.match(appSource, /gameConfig: normalizeGameConfigState\(saved\.gameConfig\),/);
    assert.match(appSource, /<GameConfigDialog/);
  });

  it("keeps session camera recording enabled by default with a quiet drawer toggle", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const apiSource = fs.readFileSync(path.resolve(__dirname, "../src/api.ts"), "utf8");
    const stylesSource = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");

    assert.match(apiSource, /recordingEnabled\?: boolean;/);
    assert.match(appSource, /recordingEnabled: saved\.recordingEnabled !== false/);
    assert.match(appSource, /recordingEnabled: true/);
    assert.match(appSource, /function setSessionRecordingEnabled\(enabled: boolean\)/);
    assert.match(appSource, /recording_enabled: menu\.recordingEnabled/);
    assert.match(appSource, /recordingEnabled: nextMenu\.recordingEnabled/);
    assert.match(appSource, /className=\{`recording-switch \$\{menu\.recordingEnabled \? "on" : "off"\}`\}/);
    assert.match(stylesSource, /\.recording-switch\s*\{/);
    assert.match(stylesSource, /\.recording-switch\.on/);
  });

  it("does not preserve unknown retired menu state keys from localStorage", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");

    assert.doesNotMatch(appSource, /\.\.\.saved,/);
    assert.match(appSource, /const savedDifficulty = difficulties\.some/);
    assert.match(appSource, /gameConfig: normalizeGameConfigState\(saved\.gameConfig\),/);
  });

  it("keeps platform level game launch identity separate from legacy engine aliases", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const localCatalogSource = fs.readFileSync(path.resolve(__dirname, "../src/localCatalog.ts"), "utf8");

    assert.match(appSource, /function runtimeGameID\(game: Pick<GameCard, "engineGame" \| "id" \| "sourceKind">\): string/);
    assert.match(appSource, /game\.sourceKind === "platform_levels" && isCanonicalEntityID\(game\.id\) \? game\.id : engineGameID\(game\)/);
    assert.match(appSource, /game: runtimeGameID\(launchGame\),\s+engineGame: engineGameID\(launchGame\),/);
    assert.match(appSource, /const levelID = String\(lvl\.id \|\| ""\)\.trim\(\);/);
    assert.match(appSource, /slug: levelSlug \|\| undefined,/);
    assert.match(appSource, /level: selectedLevelID \|\| undefined,\s+levelSlug: launchLevel\?\.slug \|\| undefined,/);
    assert.match(appSource, /function canonicalLevelID\(/);
    assert.match(appSource, /function isPlatformLaunchableSource[^}]*game\.sourceKind === "motion_levels_games"/);
    assert.match(appSource, /function isSupportedRuntimeGame/);
    const publishedProducts = new Set(["c1daea4f-e586-4116-8cbe-871cde887a81"]);
    assert.equal(isSupportedRuntimeSourceFromProducts("platform_levels", "c1daea4f-e586-4116-8cbe-871cde887a81", publishedProducts), true);
    assert.equal(isSupportedRuntimeSourceFromProducts("platform_levels", "arkanoid", publishedProducts), false);
    assert.match(appSource, /isSupportedRuntimeSource\(game\.sourceKind, game\.sourceGameId\)/);
    assert.match(localCatalogSource, /import\.meta\.glob<ManifestModule>/);
    assert.match(localCatalogSource, /manifest\.tags\?\.includes\("published-levels"\)/);
    assert.doesNotMatch(appSource.match(/function isPlatformLaunchableSource[\s\S]*?\n}/)?.[0] || "", /motion_go|animation/);
    assert.match(appSource, /game: runtimeGameID\(launchGame\)/);
    assert.doesNotMatch(appSource, /runtimeGameID\([^)]*\)[\s\S]{0,120}\|\|\s*"parkour"/);
  });
});
