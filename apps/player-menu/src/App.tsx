import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { controlGame, fetchAnimationPreview, fetchEngineStatus, fetchGameCatalog, fetchMenuState, friendlyRequestError, launchLocalPlayground, localPlaygroundEnabled, platformBaseURL, playerExperienceEventSource, postMenuEvent, postMenuState, postVenueSession, selectGame, type AnimationPreview, type ControlGameAction, type EngineGame, type EngineStatus, type MenuStateEnvelope, type PlatformGameCatalogEntry, type RecordingScope, type SelectGameRequest } from "./api";
import { PlayerExperienceStateGate, playerExperienceView } from "@motion-levels-games/player-experience";
import { categories, colors, difficulties, games, playerColorNames, playerColors, type CategoryID, type DifficultyID, type GameCard, type GameConfigVar, type PartyMiniGame } from "./catalog";
import { partyCatalogIsComplete, partyLaunchGame } from "./party";
import {
  catalogDifficultyIDs,
  closestSupportedDifficulty,
  difficultyRank,
  gameRequiresPlayerCount,
  noPlayerRequirementLabel,
  normalizeEstimatedDurationSeconds,
  platformDifficultyLabel,
  platformLevelSupportedDifficulties,
  platformPlayerBounds,
  platformPlayerConfigVars,
  platformPlayerRangeLabel,
  platformSupportedDifficulties,
  platformSupportsLevels,
  type PlayerBounds,
  playerBoundsForGame,
  rosterForGame,
  shouldPreferCatalogFallbackPreviewAnimation,
  supportedDifficultiesForGame,
} from "./catalogSync";
import { ArrowLeftIcon, BackspaceIcon, BoltIcon, CheckIcon, CloseIcon, GamepadIcon, GearIcon, PauseIcon, PlayIcon, PlusIcon, QuestionIcon, RefreshIcon, RestartIcon, SparkIcon, StarIcon, TeamIcon, UserIcon, VersusIcon, VolumeIcon, VolumeMutedIcon } from "./icons";
import { FloorPreview } from "./FloorPreview";
import { LiveFloorView } from "./LiveFloorView";
import { floorAnimations, type FloorAnim } from "./floor";
import { hexToColor, hexToRGB, publicAssetURL, randomUUID } from "./utils";
import { avatarLabel, firstAvailableColor, gameRosterIssue, playerLabel, rosterSnapshot, statusPlayersForDisplay, type Player, type RosterIssue } from "./roster";
import {
  catalogPreviewMediaSrcs,
  catalogThumbnailMediaSrcs,
  gamePreviewSrcs,
  gameThumbnailSrc,
  gameThumbnailSrcs,
  isMotionLevelsLogoSrc,
  levelHasPreviewMedia,
  levelPreviewSrc,
  levelPreviewSrcs,
  levelThumbnailSrc,
  levelThumbnailSrcs,
  partyPreviewGridSize,
  richPreviewCandidates,
  uniquePreviewSources,
} from "./previews";
import { captureMenuEvent, menuKioskID, recordMenuEvent, setMenuEventForwarder } from "./analytics";
import { nativeAnimationMediaSources, platformAnimationCards } from "./animationCatalog";
import { bundledGamesSourceRevision, floorPreviewMediaSpec } from "./bundleMedia";
import { visibleActiveLevelLaunch, type ActiveLevelLaunch, type ActiveLevelLaunchPhase, type ScreenMode } from "./runtimeFlow";
import {
  closestLevelIDForDifficulty,
  defaultLevelIDForDifficulty,
  levelsForDifficulty,
  levelSupportsDifficulty,
  normalizedDifficultyForGame,
  selectableDifficultiesForGame,
} from "./levelSelection";
import { lifeMeterModel, teamLivesFromPlayers, type LifeMeterModel } from "./lifeMeter";
import { isCanonicalEntityID } from "./identity.ts";
import { migrateLegacyLevelState } from "./levelStateMigration.ts";
import { isSupportedRuntimeSource, localProductionPlayerExperienceCatalog } from "./localCatalog.ts";
import { catalogSourceMatchesBundledRuntime } from "./runtimeSourcePolicy.ts";
import { menuAccessPolicyFromSearch } from "./menuAccess.ts";
import { resolveMenuMirrorEnvelope } from "./menuMirror.ts";
import { cleanNameDraft, cleanNameWhitespace } from "./nameEditing.ts";
import { clearedVenueSessionProjection, commitVenueSessionRecordingScope, venueSessionRecordingCanRequest, venueSessionRecordingScope, venueSessionSyncDecision, type VenueSessionObservation } from "./venueSessionSync.ts";
import {
  isRecordingGateAction,
  recordingGateActionLabel,
  recordingGateAllowsGameStarted,
  recordingGateBlocks,
  recordingGateMenuProjection,
  type RecordingGateAction,
  type RecordingGateMenuProjection,
} from "./recordingGate.ts";
import { gameForMenuIdentity } from "./gameIdentity.ts";

type MenuState = {
  sessionActive: boolean;
  sessionId: string;
  sessionStartedUnix: number;
  recordingEnabled: boolean;
  recordingPolicy: RecordingScope;
  teamName: string;
  players: Player[];
  category: CategoryID;
  selectedGame: string;
  difficulty: DifficultyID;
  selectedLevels: Record<string, string>;
  levelModes: Record<string, LevelMode>;
  levelProgress: Record<string, LevelProgress>;
  challengeRuns: Record<string, ChallengeRun>;
  freeRuns: Record<string, FreeRun>;
  nextPlayerId: number;
  narrationArmed: Record<string, boolean>;
  operatorUnlockLevels: boolean;
  gameConfig: Record<string, GameConfigValues>;
  processedAttemptIDs: string[];
};

type GameConfigValues = Record<string, number | boolean | string>;

type LevelMode = "challenge" | "free";

type LevelProgress = {
  unlockedThrough: number;
  bestByLevel: Record<string, DifficultyID>;
  bestTimeByLevel: Record<string, number>;
};

type ChallengeRun = {
  difficulty: DifficultyID;
  startedUnixMillis: number;
  completedLevels: Record<string, number>;
  totalElapsedMillis: number;
  attemptCount: number;
};

type FreeRun = {
  sessionId: string;
  startedUnixMillis: number;
  totalElapsedMillis: number;
};

type ChallengeCompletion = {
  key: string;
  difficulty: DifficultyID;
  gameID: string;
  gameLabel: string;
  revisionHash: string | null;
  levelCount: number;
  totalElapsedMillis: number;
};

type PlayerMenuEngineStatus = EngineStatus;
type FinishedLevelAttempt = NonNullable<PlayerMenuEngineStatus["finishedLevelAttempts"]>[number] & { venueSessionId?: string };
type ConnectionState = "connection-off" | "connection-on" | "connection-pending";
type KeyboardTarget = { kind: "team" } | { kind: "player"; id: number };
type PartyRunState = {
  cumulativeScore: number;
  index: number;
  partyGameID: string;
  sessionId: string;
};
type MenuMirrorSnapshot = {
  menu: MenuState;
};
type RemoteSessionRequest = {
  configuredPlayerCount: number;
  reservationId: string;
  venueSessionId: string;
  teamName: string;
  playerCount: number;
  room: string;
  startsAt: string;
};

const emptyPreviewSources: string[] = [];
const storageKey = "ml-player-menu-state-v1";
const partyRunStorageKey = "ml-player-menu-party-run-v1";
const venueSessionObservationStorageKey = "ml-player-menu-venue-session-observation-v1";
const platformCatalogStorageKey = "ml-player-menu-platform-catalog-v3";
// Cache keys older menu builds wrote; purged at boot so long-lived kiosks do
// not carry multi-megabyte orphaned catalog payloads forever.
const retiredStorageKeys = [
  "ml-player-menu-platform-catalog-v1",
  "ml-player-menu-platform-catalog-v2",
];
const platformCatalogRefreshMillis = 5000;
const platformCatalogRefreshMaxMillis = 60_000;
const maxPlayers = 8;
const maxTeamNameLength = 24;
const maxPlayerNameLength = 12;
const noPressureSessionLimitMillis = 60 * 60 * 1000;
const maxProcessedAttemptIDs = 128;
// Spanish QWERTY adapted for a kiosk touch surface.
const keyboardLetterRows = ["qwertyuiop", "asdfghjklñ", "zxcvbnm"];
const keyboardNumberRows = ["1234567890", "-_/&()'\"", ".,!?"];
const keyboardAccentRows = ["áéíóúü", "àèìòù", "äëïöüñ"];
const envUnlockLevels = import.meta.env.VITE_UNLOCK_LEVELS === "1";
const operatorSettingsPin = /^\d{6}$/.test(import.meta.env.VITE_DEV_SETTINGS_PIN || "") ? import.meta.env.VITE_DEV_SETTINGS_PIN || "" : "739481";
const defaultPlayers: Player[] = [{ id: 1, name: "", color: playerColors[0], active: true }];
const teamNameStarts = ["Rayo", "Neón", "Pulso", "Láser", "Cumbre", "Órbita", "Turbo", "Brillo", "Salto", "Ritmo", "Chispa", "Fuego"];
const teamNameFinishes = ["Verde", "Azul", "Solar", "Norte", "Sur", "Lima", "Rojo", "Claro", "Pista", "Nivel", "Flash", "Veloz"];
const recordingModeOptions: Array<{ description: string; label: string; scope: RecordingScope }> = [
  { scope: "off", label: "Desactivada", description: "Sin vídeo" },
  { scope: "visit", label: "Sesión completa", description: "Grabación continua toda la sesión" },
  { scope: "selection", label: "Cada juego", description: "Los reinicios siguen juntos" },
  { scope: "run", label: "Cada intento", description: "Separa cada reinicio" },
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value.trim());
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function systemStatusLabel(connectionState: ConnectionState, floorReady: boolean): string {
  if (connectionState === "connection-pending") return "Motor conectando";
  if (connectionState === "connection-off") return "Motor reconectando";
  return floorReady ? "Sistema listo" : "Suelo sin señal";
}

function engineStatusLabel(connectionState: ConnectionState): string {
  if (connectionState === "connection-pending") return "Conectando";
  if (connectionState === "connection-off") return "Reconectando";
  return "Conectado";
}

function playerColorInk(color: string): string {
  const { r, g, b } = hexToColor(color);
  // Keep player labels crisp without muting the floor-identifying colors.
  return (r * 299 + g * 587 + b * 114) / 1000 >= 142 ? "#061018" : "#f7fbff";
}

function playerRangeLabel(game: GameCard): string {
  if (!gameRequiresPlayerCount(game)) return noPlayerRequirementLabel;
  const bounds = playerBoundsForGame(game);
  if (game.players && !/^\d+(?:-\d+)?$/.test(game.players.trim())) return game.players;
  const count = bounds.minPlayers === bounds.maxPlayers ? String(bounds.minPlayers) : `${bounds.minPlayers}-${bounds.maxPlayers}`;
  const plural = bounds.maxPlayers === 1 ? "jugador" : "jugadores";
  return `${count} ${plural}`;
}

function gameCardMeta(game: GameCard, active: boolean, selected: boolean): {
  ariaLabel?: string;
  className: string;
  icon?: ReactNode;
  label: string;
} | null {
  if (active) return { className: "live", label: "En juego" };
  if (game.players && gameRequiresPlayerCount(game)) {
    return {
      ariaLabel: `Jugadores: ${playerRangeLabel(game)}`,
      className: "players",
      icon: <TeamIcon />,
      label: game.players,
    };
  }
  return null;
}

function remoteSessionRequestFromURL(): RemoteSessionRequest | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("remoteSession") !== "reservation") return null;
  const venueSessionId = params.get("venueSessionId") || "";
  const reservationId = params.get("reservationId") || venueSessionId;
  if (!isUUID(venueSessionId) || !isUUID(reservationId)) return null;
  const reservedPlayers = clampInteger(Number(params.get("players") || 1), 1, maxPlayers);

  return {
    configuredPlayerCount: clampInteger(reservedPlayers, 1, maxPlayers),
    playerCount: reservedPlayers,
    reservationId: reservationId.toLowerCase(),
    room: cleanNameWhitespace(params.get("room") || "Sala remota", 40),
    startsAt: params.get("startsAt") || "",
    teamName: cleanNameWhitespace(params.get("teamName") || defaultTeamName(), maxTeamNameLength),
    venueSessionId: venueSessionId.toLowerCase(),
  };
}

function clearRemoteSessionURL() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of ["remoteSession", "reservationId", "venueSessionId", "players", "room", "startsAt", "teamName"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function floorOnlyFromURL(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("floorOnly") === "1" || params.get("floor") === "1" || params.get("mode") === "floor";
}

function playersForCount(count: number): Player[] {
  return Array.from({ length: clampInteger(count, 1, maxPlayers) }, (_, index) => ({
    active: true,
    color: playerColors[index % playerColors.length],
    id: index + 1,
    name: "",
  }));
}

function newVenueSessionID(): string {
  return randomUUID();
}

function defaultTeamName(date = new Date()): string {
  const seed = Math.max(0, Math.floor(date.getTime() / 1000));
  const start = teamNameStarts[seed % teamNameStarts.length];
  const finish = teamNameFinishes[Math.floor(seed / teamNameStarts.length) % teamNameFinishes.length];
  const code = 100 + (seed % 900);
  return `${start} ${finish} ${code}`;
}

function engineGameID(game: Pick<GameCard, "engineGame" | "id">): string {
  return game.engineGame || game.id;
}

function runtimeGameID(game: Pick<GameCard, "engineGame" | "id" | "sourceKind">): string {
  return game.sourceKind === "platform_levels" && isCanonicalEntityID(game.id) ? game.id : engineGameID(game);
}

function previewAnimationID(game: GameCard): string {
  if (engineGameID(game) === "salvapantallas") return "";
  return game.previewAnimation || game.id;
}

function levelFallbackPreviewAnimationID(game: GameCard, level?: NonNullable<GameCard["levels"]>[number]): string {
  if (levelHasPreviewMedia(level)) return "";
  if (level?.previewAnimation) return level.previewAnimation;
  return previewAnimationID(game);
}

function isAmbientCard(game: GameCard): boolean {
  return game.category === "attract";
}

function isPartyCard(game: GameCard): boolean {
  return Boolean(game.partyMiniGames?.length);
}

function isFeaturedCard(game: GameCard): boolean {
  return game.featured === true || game.category === "featured";
}

function categoryIcon(categoryID: CategoryID) {
  switch (categoryID) {
    case "featured":
      return <StarIcon />;
    case "team":
      return <TeamIcon />;
    case "versus":
      return <VersusIcon />;
    case "individual":
      return <UserIcon />;
    case "arcade":
      return <GamepadIcon />;
    case "attract":
      return <SparkIcon />;
    default:
      return <StarIcon />;
  }
}

function isScreensaverCard(game: Pick<GameCard, "engineGame" | "id">): boolean {
  return engineGameID(game) === "salvapantallas" || game.id === "salvapantallas";
}

function isInternalAnimationsAggregate(value: Pick<GameCard, "engineGame" | "id"> | PlatformGameCatalogEntry): boolean {
  if ("engine_game" in value) {
    return value.id === "animations" || platformEntryEngineGame(value) === "animations";
  }
  return value.id === "animations" || engineGameID(value) === "animations";
}

function gamesForCategory(catalogGames: GameCard[], category: CategoryID): GameCard[] {
  if (category === "featured") return catalogGames.filter(isFeaturedCard);
  return catalogGames.filter((game) => game.category === category);
}

function gameBelongsToCategory(game: GameCard, category: CategoryID): boolean {
  return category === "featured" ? isFeaturedCard(game) : game.category === category;
}

function menuCategoryForGame(game: GameCard, currentCategory: CategoryID): CategoryID {
  if (currentCategory === "featured" && isFeaturedCard(game)) return "featured";
  return game.category;
}

function animationIsIdleLoop(currentGame: string, phase: string): boolean {
  return (
    currentGame === "salvapantallas"
    || currentGame === "animations"
    || currentGame.startsWith("animation-")
  ) && (phase === "idle" || phase === "ambient");
}

function isStoppedRuntimePhase(status: EngineStatus | null): boolean {
  const phase = (status?.phase || "").toLowerCase();
  return phase === "finished" || phase === "idle" || phase === "ambient";
}

function isLevelRuntimeActive(status: EngineStatus | null, game: GameCard): boolean {
  if (!status || !game.levels?.length || isAmbientCard(game)) return false;
  if (animationIsIdleLoop(status.currentGame, status.phase)) return false;
  return !isStoppedRuntimePhase(status);
}

function gameForEngineStatus(engineGame: string, currentMenuGameID: string, catalogGames = games): GameCard | undefined {
  const currentMenuGame = gameForMenuIdentity(catalogGames, currentMenuGameID);
  if (currentMenuGame && isPartyCard(currentMenuGame)) {
    const partyMiniGameMatches = (currentMenuGame.partyMiniGames || []).some((_, index) => {
      const launchGame = partyLaunchGame(currentMenuGame, catalogGames, index);
      return Boolean(launchGame && (runtimeGameID(launchGame) === engineGame || engineGameID(launchGame) === engineGame));
    });
    if (partyMiniGameMatches) return currentMenuGame;
  }
  const matches = catalogGames.filter((game) => runtimeGameID(game) === engineGame || engineGameID(game) === engineGame);
  if (matches.length === 0) return undefined;
  return matches.find((game) => game.id === currentMenuGameID) || matches.find((game) => !game.id.startsWith("featured-")) || matches[0];
}

function liveAnimationCards(catalog: EngineGame[] | undefined, existingGames: GameCard[] = games): GameCard[] {
  const existingEngineGames = new Set(existingGames.map(engineGameID));
  const animationColors = [colors.cyan, colors.blue, colors.green, colors.violet, colors.orange, colors.yellow];
  return (catalog || [])
    .filter((entry) => entry.game.startsWith("animation-") && !existingEngineGames.has(entry.game))
    .map((entry, index): GameCard => {
      const animationId = entry.game.replace(/^animation-/, "");
      const nativeMedia = nativeAnimationMediaSources(animationId);
      return {
        id: entry.game,
        label: entry.label || animationId,
        category: "attract",
        color: animationColors[index % animationColors.length],
        players: "Todos",
        difficulty: "Ambiente",
        duration: "Bucle",
        mode: "Ambiente",
        audio: entry.music ? "Música" : "Suave",
        description: entry.description || "Animación ambiental para la pista.",
        rules: ["Pisa la pista para interactuar.", "Puedes cambiar de animación en cualquier momento."],
        engineGame: entry.game,
        previewAnimation: nativeMedia ? undefined : entry.game,
        ...nativeMedia,
        featured: false,
      };
    });
}

function isCategoryID(value: string): value is CategoryID {
  return categories.some((category) => category.id === value);
}

function platformEntryEngineGame(entry: PlatformGameCatalogEntry): string {
  return entry.engine_game || entry.id;
}

function isPlatformLevelSource(entry: PlatformGameCatalogEntry): boolean {
  return entry.source_kind === "platform_levels";
}

function platformEntryMatchesGame(entry: PlatformGameCatalogEntry, game: Pick<GameCard, "engineGame" | "id">): boolean {
  return entry.id === game.id || platformEntryEngineGame(entry) === engineGameID(game);
}

function platformPartyMiniGames(entry: PlatformGameCatalogEntry): PartyMiniGame[] | undefined {
  const source = entry.game_source;
  if (!source || source.schema !== "motion-party-v1" || source.kind !== "party") return undefined;
  const rawMiniGames = Array.isArray(source.mini_games) ? source.mini_games : [];
  const miniGames = rawMiniGames.flatMap((item): PartyMiniGame[] => {
    const record = typeof item === "string" ? { game_id: item } : item;
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const value = record as Record<string, unknown>;
    const gameId = typeof value.game_id === "string" ? value.game_id.trim() : "";
    if (!gameId) return [];
    const difficulty = catalogDifficultyIDs.includes(value.difficulty as DifficultyID) ? value.difficulty as DifficultyID : undefined;
    const difficultyMode = value.difficulty_mode === "override" && difficulty
      ? "override"
      : value.difficulty_mode === "inherit"
        ? "inherit"
        : difficulty ? "override" : "inherit";
    return [{
      gameId,
      label: typeof value.label === "string" ? value.label : undefined,
      difficultyMode,
      difficulty,
      level: typeof value.level === "string" ? value.level : undefined,
    }];
  });
  return miniGames.length ? miniGames : undefined;
}

function scoreFromStatus(status: EngineStatus | null): number {
  return Math.max(0, Math.round((status?.players || []).reduce((total, player) => total + (Number(player.score) || 0), 0)));
}

function finishedAttemptMatchesLevel(attempt: FinishedLevelAttempt, game: GameCard, levelID: string, status: EngineStatus | null): boolean {
  if (!levelID || !levelIDsMatch(game, attempt.level, levelID)) return false;
  const gameIDs = new Set([game.id, engineGameID(game), runtimeGameID(game)].filter(Boolean));
  if (!gameIDs.has(attempt.game)) return false;
  if (status?.difficulty && attempt.difficulty && attempt.difficulty !== status.difficulty) return false;
  const sessionStartedUnixNanos = Math.max(0, Number(status?.startedUnix || 0)) * 1_000_000_000;
  return !sessionStartedUnixNanos || Number(attempt.endedUnixNanos || 0) >= sessionStartedUnixNanos;
}

function levelAttemptSummary(status: EngineStatus | null, game: GameCard, levelID: string): { attempts: number; failures: number } {
  if (!status || !levelID) return { attempts: 0, failures: 0 };
  const finishedAttempts = (status.finishedLevelAttempts || []).filter((attempt) => finishedAttemptMatchesLevel(attempt, game, levelID, status));
  const failures = finishedAttempts.filter((attempt) => !attempt.success || attempt.result === "failed").length;
  const activeAttempt = activeLevelAttempt(status, game, levelID);
  return {
    attempts: finishedAttempts.length + (activeAttempt ? 1 : 0),
    failures,
  };
}

function activeLevelAttempt(status: EngineStatus | null, game: GameCard, levelID: string): boolean {
  return Boolean(
    status
    && levelID
    && !isStoppedRuntimePhase(status)
    && !animationIsIdleLoop(status.currentGame, status.phase)
    && levelIDsMatch(game, status.level || "", levelID),
  );
}

function catalogPreviewAnimation(
  entry: PlatformGameCatalogEntry,
  fallback: GameCard | undefined,
  engineGame: string,
  preferFallbackAnimation: boolean,
): string | undefined {
  if (engineGame === "salvapantallas") return undefined;
  const configured = String(entry.catalog_preview_animation || "").trim();
  if (preferFallbackAnimation) return configured || fallback?.previewAnimation;
  if (configured) return configured;
  if (fallback?.previewAnimation) return fallback.previewAnimation;
  if (isPlatformLevelSource(entry)) return undefined;
  return fallback?.previewAnimation || (entry.source_kind === "animation" || entry.catalog_category === "attract" ? engineGame : undefined);
}

function platformEntryToGameCard(entry: PlatformGameCatalogEntry, fallback: GameCard | undefined, index: number): GameCard {
  const engineGame = platformEntryEngineGame(entry);
  const preferFallbackAnimation = shouldPreferCatalogFallbackPreviewAnimation(entry, fallback);
  const previewAnimation = catalogPreviewAnimation(entry, fallback, engineGame, preferFallbackAnimation);
  const thumbnailSrcs = catalogThumbnailMediaSrcs(entry);
  const previewSrcs = catalogPreviewMediaSrcs(entry);
  const thumbnailSrc = thumbnailSrcs[0];
  const previewSrc = previewSrcs[0];
  const playerBounds = platformPlayerBounds(entry);
  const supportedDifficulties = platformSupportedDifficulties(entry);
  const supportsLevels = platformSupportsLevels(entry);
  const estimatedDurationSeconds = normalizeEstimatedDurationSeconds(entry.estimated_duration_seconds);
  const partyMiniGames = platformPartyMiniGames(entry);
  const levels = supportsLevels && entry.levels && entry.levels.length > 0
	    ? Array.from(entry.levels.reduce((byID, lvl) => {
	        const levelID = String(lvl.id || "").trim();
	        const levelSlug = String(lvl.slug || "").trim();
	        if (!levelID) return byID;
	        const levelKey = levelSlug || levelID;
	        const fallbackLevel = fallback?.levels?.find((level) => level.id === levelID || level.id === levelSlug || level.slug === levelSlug);
	        const levelDifficulties = platformLevelSupportedDifficulties(lvl);
	        const rowDifficulty = catalogDifficultyIDs.includes(lvl.difficulty as DifficultyID) ? lvl.difficulty as DifficultyID : undefined;
	        const platformThumbnailSrcs = catalogThumbnailMediaSrcs(lvl);
	        const platformPreviewSrcs = catalogPreviewMediaSrcs(lvl);
	        const hasLevelMedia = platformPreviewSrcs.length > 0 || platformThumbnailSrcs.length > 0;
	        const existing = byID.get(levelKey);
	        const canonicalIdsByDifficulty = { ...(existing?.canonicalIdsByDifficulty || {}) };
	        for (const difficulty of rowDifficulty ? [rowDifficulty] : levelDifficulties || []) canonicalIdsByDifficulty[difficulty] = levelID;
	        byID.set(levelKey, {
	          id: existing?.id || levelID,
	          slug: levelSlug || undefined,
	          canonicalIdsByDifficulty,
	          label: existing?.label || lvl.label,
	          description: existing?.description || lvl.description,
	          difficulties: Array.from(new Set([...(existing?.difficulties || []), ...(levelDifficulties || [])])),
	          thumbnailSrc: existing?.thumbnailSrc || platformThumbnailSrcs[0],
	          thumbnailSrcs: existing?.thumbnailSrcs || platformThumbnailSrcs,
	          previewSrc: existing?.previewSrc || platformPreviewSrcs[0] || fallbackLevel?.previewSrc || fallback?.previewSrc,
	          previewSrcs: existing?.previewSrcs || platformPreviewSrcs,
	          previewByDifficulty: existing?.previewByDifficulty || fallbackLevel?.previewByDifficulty,
	          previewAnimation: hasLevelMedia ? undefined : existing?.previewAnimation || fallbackLevel?.previewAnimation,
	          previewRevisionHash: existing?.previewRevisionHash || lvl.settings_hash || lvl.updated_at,
	        });
        return byID;
      }, new Map<string, NonNullable<GameCard["levels"]>[number]>()).values())
    : undefined;
  const category = partyMiniGames?.length
    ? "versus"
    : isCategoryID(entry.catalog_category) ? entry.catalog_category : fallback?.category || "arcade";
  return {
    id: entry.id,
    label: entry.label || fallback?.label || engineGame,
    category,
    color: entry.catalog_color || fallback?.color || [colors.cyan, colors.blue, colors.green, colors.violet, colors.orange, colors.yellow][index % 6],
    players: platformPlayerRangeLabel(entry),
    difficulty: platformDifficultyLabel(entry),
    difficulties: supportedDifficulties,
    duration: "",
    estimatedDurationSeconds,
    mode: entry.mode_label || fallback?.mode || "",
    audio: entry.audio_label || fallback?.audio || "",
    description: entry.description || fallback?.description || "Juego visible desde el catálogo.",
    rules: entry.catalog_rules?.length ? entry.catalog_rules : fallback?.rules || ["Sigue las indicaciones que aparecen al comenzar."],
    featured: typeof entry.catalog_featured === "boolean" ? entry.catalog_featured : fallback?.featured === true || entry.catalog_category === "featured",
    levels,
    partyMiniGames,
    allowDifficultyWithLevels: supportsLevels && (fallback?.allowDifficultyWithLevels || (isPlatformLevelSource(entry) && Boolean(levels?.length))),
    engineGame,
    minPlayers: playerBounds.minPlayers,
    maxPlayers: playerBounds.maxPlayers,
    allowAnyPlayers: entry.allow_any_players === true,
    thumbnailSrc,
    thumbnailSrcs,
    previewSrc,
    previewSrcs,
    previewAnimation,
    supportsLevels,
    sourceKind: entry.source_kind || fallback?.sourceKind,
    // Platform rows created before revision pinning may omit the source SHA.
    // The catalog filter only admits products confirmed by this bundle/runtime,
    // so complete that legacy metadata with the locally compiled revision.
    sourceRevision: entry.source_revision || fallback?.sourceRevision || bundledGamesSourceRevision(),
    sourceGameId: entry.source_game_id || fallback?.sourceGameId,
    countdownFloorOverlay: entry.countdown_floor_overlay === true,
    revisionHash: entry.revision_hash || fallback?.revisionHash,
    disabled: !isSupportedRuntimeCatalogEntry(entry, fallback),
    configVars: platformPlayerConfigVars(entry),
  };
}

function playerBoundsRangeValue(bounds: PlayerBounds): string {
  return bounds.minPlayers === bounds.maxPlayers ? String(bounds.minPlayers) : `${bounds.minPlayers}-${bounds.maxPlayers}`;
}

function gameMatchesPartyMiniGame(candidate: Pick<GameCard, "engineGame" | "id">, gameID: string): boolean {
  return candidate.id === gameID || engineGameID(candidate) === gameID;
}

function derivedPartyPlayerBounds(game: GameCard, catalogGames: GameCard[]): PlayerBounds {
  const fallback = playerBoundsForGame(game);
  if (!isPartyCard(game) || !game.partyMiniGames?.length) return fallback;
  const miniGameBounds = game.partyMiniGames
    .map((miniGame) => catalogGames.find((candidate) => gameMatchesPartyMiniGame(candidate, miniGame.gameId)))
    .filter((candidate): candidate is GameCard => Boolean(candidate))
    .map((miniGame) => playerBoundsForGame(miniGame));
  if (!miniGameBounds.length) return fallback;
  const minPlayers = Math.max(...miniGameBounds.map((bounds) => bounds.minPlayers));
  const maxPlayers = Math.min(...miniGameBounds.map((bounds) => bounds.maxPlayers));
  return { minPlayers, maxPlayers: Math.max(minPlayers, maxPlayers) };
}

function applyDerivedPartyPlayerRanges(catalogGames: GameCard[]): GameCard[] {
  return catalogGames.map((game) => {
    if (!isPartyCard(game)) return game;
    const bounds = derivedPartyPlayerBounds(game, catalogGames);
    const players = playerBoundsRangeValue(bounds);
    if (game.minPlayers === bounds.minPlayers && game.maxPlayers === bounds.maxPlayers && game.players === players) return game;
    return {
      ...game,
      minPlayers: bounds.minPlayers,
      maxPlayers: bounds.maxPlayers,
      players,
    };
  });
}

function bundledProductionGameCards(): GameCard[] {
  const fallbackByID = new Map(games.map((game) => [game.id, game]));
  const fallbackByEngine = new Map(games.map((game) => [engineGameID(game), game]));
  return localProductionPlayerExperienceCatalog()
    .map((entry, index) => {
      const fallback = fallbackByID.get(entry.id) || fallbackByEngine.get(platformEntryEngineGame(entry));
      const game = platformEntryToGameCard(entry, fallback, index);
      return {
        ...game,
        // Category is intrinsic manifest metadata. Featured is platform-owned;
        // only retain the deliberately curated bundled fallback while offline.
        featured: fallback?.featured === true,
      };
    })
    // Keep the curated fallback first so a failed cloud fetch still opens on
    // Destacados instead of an arbitrary alphabetically-first game.
    .sort((left, right) => Number(right.featured === true) - Number(left.featured === true));
}

function applyPlatformCatalog(
  baseGames: GameCard[],
  catalog: PlatformGameCatalogEntry[] | null,
  runtimeCatalog: EngineGame[] | undefined = undefined,
): GameCard[] {
  if (!catalog) return applyDerivedPartyPlayerRanges(baseGames);
  const fallbackByID = new Map(baseGames.map((game) => [game.id, game]));
  const fallbackByEngine = new Map(baseGames.map((game) => [engineGameID(game), game]));
  const fallbackForEntry = (entry: PlatformGameCatalogEntry) => (
    fallbackByID.get(entry.id) || fallbackByEngine.get(platformEntryEngineGame(entry))
  );
  const baseOrder = new Map(baseGames.map((game, index) => [game.id, index]));
  const bundledRuntimeIDs = new Set((runtimeCatalog || []).flatMap((entry) => {
    const gameID = String(entry.game || "").trim().toLowerCase();
    return [gameID, gameID.replace(/^motion-levels-games:/u, "")];
  }));
  const hasBundledProduct = (entry: PlatformGameCatalogEntry, fallback: GameCard | undefined) => {
    if (fallback) return true;
    return [entry.source_game_id, platformEntryEngineGame(entry)].some((value) => {
      const gameID = String(value || "").trim().toLowerCase();
      return bundledRuntimeIDs.has(gameID) || bundledRuntimeIDs.has(gameID.replace(/^motion-levels-games:/u, ""));
    });
  };
  const enabledCatalog = catalog.filter((entry) => (
    entry.catalog_enabled !== false
    && !isInternalAnimationsAggregate(entry)
    && isSupportedRuntimeCatalogEntry(entry, fallbackForEntry(entry))
    && catalogSourceMatchesBundledRuntime(
      entry.source_kind || fallbackForEntry(entry)?.sourceKind,
      entry.source_revision,
      bundledGamesSourceRevision(),
      hasBundledProduct(entry, fallbackForEntry(entry)),
    )
  ));
  const catalogOrderByID = new Map(enabledCatalog.map((entry) => [entry.id, entry.catalog_order]));
  const catalogOrderByEngine = new Map(enabledCatalog.map((entry) => [platformEntryEngineGame(entry), entry.catalog_order]));
  const platformGames = enabledCatalog
    .map((entry, index) => platformEntryToGameCard(
      entry,
      fallbackForEntry(entry),
      index,
    ));
  const remainingBaseGames = baseGames.filter((game) => (
    !isInternalAnimationsAggregate(game)
    && isSupportedRuntimeGame(game)
    // catalog_enabled is an operator kill-switch, independent of a staged
    // source revision, so an explicit disable always hides the local card.
    && !catalog.some((entry) => platformEntryMatchesGame(entry, game) && entry.catalog_enabled === false)
    && !enabledCatalog.some((entry) => platformEntryMatchesGame(entry, game))
  ));
  const orderedGames = [...platformGames, ...remainingBaseGames]
    .sort((left, right) => {
      const leftOrder = catalogOrderByID.get(left.id) ?? catalogOrderByEngine.get(engineGameID(left)) ?? 10_000 + (baseOrder.get(left.id) ?? 0);
      const rightOrder = catalogOrderByID.get(right.id) ?? catalogOrderByEngine.get(engineGameID(right)) ?? 10_000 + (baseOrder.get(right.id) ?? 0);
      return leftOrder - rightOrder || left.label.localeCompare(right.label);
    });
  return applyDerivedPartyPlayerRanges(orderedGames);
}

function platformCatalogMenuSignature(catalog: PlatformGameCatalogEntry[]): string {
  return catalog
    .map((entry) => JSON.stringify([
      entry.id,
      entry.engine_game || "",
      entry.catalog_category || "",
      entry.catalog_enabled !== false,
      entry.catalog_featured === true,
      entry.source_kind || "",
      entry.source_revision || "",
      entry.source_game_id || "",
    ]))
    .sort()
    .join("\n");
}

function isPlatformLaunchableSource(game: Pick<GameCard, "sourceKind">): boolean {
  return game.sourceKind === "motion_levels_games" || game.sourceKind === "platform_levels";
}

function isSupportedRuntimeCatalogEntry(entry: PlatformGameCatalogEntry, fallback?: GameCard): boolean {
  return isSupportedRuntimeSource(
    entry.source_kind || fallback?.sourceKind,
    entry.source_game_id || fallback?.sourceGameId,
  );
}

function isSupportedRuntimeGame(game: GameCard): boolean {
  return (
    isAmbientCard(game) && engineGameID(game).startsWith("animation-")
  ) || isSupportedRuntimeSource(game.sourceKind, game.sourceGameId);
}

function canLaunchWhileCatalogRefreshes(game: GameCard): boolean {
  return isAmbientCard(game) && isSupportedRuntimeGame(game);
}

function isIndividualCard(game: GameCard): boolean {
  return game.category === "individual";
}

function usesDifficulty(game: GameCard): boolean {
  return !isAmbientCard(game) && (!game.levels?.length || Boolean(game.allowDifficultyWithLevels));
}

function supportsNarration(game: GameCard): boolean {
  return !isAmbientCard(game);
}

function defaultLevelID(game: GameCard): string {
  return defaultLevelIDForDifficulty(game, selectableDifficultiesForGame(game)[0] || catalogDifficultyIDs[0]);
}

function levelNumber(levelID: string): number {
  const value = Number(levelID.replace(/^level-/, ""));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function logicalLevelForGame(game: Pick<GameCard, "levels"> | undefined, value: string | undefined): NonNullable<GameCard["levels"]>[number] | undefined {
  if (!value) return undefined;
  return game?.levels?.find((candidate) => candidate.id === value || candidate.slug === value || Object.values(candidate.canonicalIdsByDifficulty || {}).includes(value));
}

function logicalLevelIndexForGame(game: Pick<GameCard, "levels"> | undefined, value: string | undefined): number {
  if (!value) return -1;
  return game?.levels?.findIndex((candidate) => candidate.id === value || candidate.slug === value || Object.values(candidate.canonicalIdsByDifficulty || {}).includes(value)) ?? -1;
}

function canonicalLevelID(game: Pick<GameCard, "levels"> | undefined, value: string, difficulty?: DifficultyID): string {
  if (!value) return "";
  const level = logicalLevelForGame(game, value);
  if (!level) return "";
  if (Object.values(level.canonicalIdsByDifficulty || {}).includes(value)) return value;
  return (difficulty && level.canonicalIdsByDifficulty?.[difficulty]) || level.id;
}

function levelIDsMatch(game: Pick<GameCard, "levels"> | undefined, left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftLevel = logicalLevelForGame(game, left);
  const rightLevel = logicalLevelForGame(game, right);
  return Boolean(leftLevel && leftLevel === rightLevel);
}

function levelNumberForGame(game: Pick<GameCard, "levels">, levelID: string): number {
  const level = logicalLevelForGame(game, levelID);
  return levelNumber(level?.slug || level?.id || levelID);
}

function playerLevelLabel(level: NonNullable<GameCard["levels"]>[number] | undefined, index?: number): string {
  if (!level) return "Nivel";
  const label = String(level.label || "").trim();
  if (label && !/^level[-_\s]?\d+$/i.test(label)) return label;
  const number = typeof index === "number" && index >= 0 ? index + 1 : levelNumber(level.slug || level.id);
  return `Nivel ${number}`;
}

function supportedDifficultiesFor(game: GameCard, level?: NonNullable<GameCard["levels"]>[number]): DifficultyID[] {
  if (!usesDifficulty(game)) return [...catalogDifficultyIDs];
  return supportedDifficultiesForGame(game, level);
}

function activeDifficultyForGame(game: GameCard, state: MenuState): DifficultyID {
  const requested = levelModeFor(game, state) === "challenge"
    ? challengeRunFor(game, state)?.difficulty || state.difficulty
    : state.difficulty;
  return normalizedDifficultyForGame(game, requested);
}

function higherDifficulty(a: DifficultyID | undefined, b: DifficultyID): DifficultyID {
  if (!a) return b;
  return difficultyRank(b) > difficultyRank(a) ? b : a;
}

function progressFor(game: GameCard, state: MenuState): LevelProgress {
  const progress = state.levelProgress[game.id];
  return { unlockedThrough: progress?.unlockedThrough || 1, bestByLevel: progress?.bestByLevel || {}, bestTimeByLevel: progress?.bestTimeByLevel || {} };
}

function levelModeFor(game: GameCard, state: MenuState): LevelMode {
  if (!game.levels?.length) return "free";
  return state.levelModes[game.id] === "challenge" ? "challenge" : "free";
}

function levelModeFromEngine(value: string | undefined): LevelMode | null {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "challenge" || normalized === "reto") return "challenge";
  if (normalized === "free" || normalized === "libre") return "free";
  return null;
}

function activeLevelModeFor(game: GameCard, state: MenuState, status: EngineStatus | null): LevelMode {
  const configuredMode = levelModeFor(game, state);
  const engineMode = levelModeFromEngine(status?.levelMode);
  if (engineMode) return engineMode;
  if (!game.levels?.length || configuredMode === "free" || !status?.level) return configuredMode;
  const difficulty = activeDifficultyForGame(game, state);
  const expectedChallengeLevel = challengeNextLevel(game, state)?.id || defaultLevelIDForDifficulty(game, difficulty);
  return levelIDsMatch(game, status.level, expectedChallengeLevel) ? "challenge" : "free";
}

function challengeRunFor(game: GameCard, state: MenuState): ChallengeRun | null {
  const run = state.challengeRuns[game.id];
  if (!run || typeof run !== "object") return null;
  return {
    difficulty: difficulties.some((candidate) => candidate.id === run.difficulty) ? run.difficulty : state.difficulty,
    startedUnixMillis: Number(run.startedUnixMillis) || 0,
    completedLevels: run.completedLevels || {},
    totalElapsedMillis: Number(run.totalElapsedMillis) || 0,
    attemptCount: Math.max(0, Math.round(Number(run.attemptCount) || 0)),
  };
}

function freeRunFor(game: GameCard, state: MenuState): FreeRun | null {
  const run = state.freeRuns[game.id];
  if (!run || typeof run !== "object") return null;
  const sessionId = typeof run.sessionId === "string" ? run.sessionId : "";
  if (state.sessionId && sessionId && sessionId !== state.sessionId) return null;
  return {
    sessionId,
    startedUnixMillis: Number(run.startedUnixMillis) || 0,
    totalElapsedMillis: Math.max(0, Math.round(Number(run.totalElapsedMillis) || 0)),
  };
}

function challengeNextLevel(game: GameCard, state: MenuState): NonNullable<GameCard["levels"]>[number] | null {
  if (!game.levels?.length) return null;
  const completed = challengeRunFor(game, state)?.completedLevels || {};
  const levels = levelsForDifficulty(game, activeDifficultyForGame(game, state));
  return levels.find((level) => !completed[level.id]) || levels[0] || null;
}

function challengeTotalElapsed(completedLevels: Record<string, number>): number {
  return Object.values(completedLevels).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function emptyChallengeRun(difficulty: DifficultyID, startedUnixMillis = Date.now()): ChallengeRun {
  return {
    difficulty,
    startedUnixMillis,
    completedLevels: {},
    totalElapsedMillis: 0,
    attemptCount: 0,
  };
}

function emptyFreeRun(sessionId: string, startedUnixMillis = Date.now()): FreeRun {
  return {
    sessionId,
    startedUnixMillis,
    totalElapsedMillis: 0,
  };
}

function unlockLevelsEnabled(state: MenuState): boolean {
  return envUnlockLevels || state.operatorUnlockLevels;
}

function isLevelUnlocked(game: GameCard, levelID: string, state: MenuState): boolean {
  return isLevelUnlockedForMode(game, levelID, state, levelModeFor(game, state));
}

function isLevelUnlockedForMode(game: GameCard, levelID: string, state: MenuState, mode: LevelMode): boolean {
  if (!game.levels?.length) return true;
  const level = logicalLevelForGame(game, levelID);
  if (!levelSupportsDifficulty(game, level, activeDifficultyForGame(game, state))) return false;
  if (unlockLevelsEnabled(state)) return true;
  if (mode === "free") return true;
  return levelIDsMatch(game, challengeNextLevel(game, state)?.id || "", levelID);
}

function challengeLevelPreviewRevealed(game: GameCard, levelID: string, state: MenuState, active: boolean, mode = levelModeFor(game, state)): boolean {
  if (levelModeFor(game, state) === "free") return true;
  if (mode === "free") return true;
  if (active) return true;
  return challengeRunFor(game, state)?.completedLevels[levelID] !== undefined;
}

function difficultyColor(difficulty?: DifficultyID): string {
  return difficulties.find((candidate) => candidate.id === difficulty)?.color || colors.green;
}

function formatBestTime(ms?: number): string {
  if (!ms || ms <= 0) return "Sin marca";
  const totalTenths = Math.round(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}` : `${seconds}.${tenths}s`;
}

function formatRuntimeTime(ms?: number): string {
  if (!ms || ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

function starCountForDifficulty(difficulty?: DifficultyID): number {
  if (!difficulty) return 0;
  return Math.max(0, difficultyRank(difficulty) + 1);
}

function StarRating({ difficulty, label = "Dificultad", muted = false }: { difficulty?: DifficultyID; label?: string; muted?: boolean }) {
  const count = starCountForDifficulty(difficulty);
  return (
    <span className={`star-rating ${muted ? "muted" : ""}`} aria-label={difficulty ? `${label}: ${count} de 4` : `${label}: sin superar`}>
      {[0, 1, 2, 3].map((index) => (
        <span key={index} aria-hidden="true" className={index < count ? "filled" : ""}>
          {index < count ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

function difficultyFromEngine(value: string | undefined, fallback: DifficultyID): DifficultyID {
  return difficulties.some((candidate) => candidate.id === value) ? (value as DifficultyID) : fallback;
}

function recordLevelCompletion(
  state: MenuState,
  game: GameCard,
  levelID: string,
  success: boolean,
  difficulty: DifficultyID,
  elapsedMillis: number,
): MenuState {
  if (!game.levels?.length || !levelID) return state;
  levelID = canonicalLevelID(game, levelID, difficulty) || levelID;
  const finishedNumber = levelNumberForGame(game, levelID);
  const previous = progressFor(game, state);
  const nextBest = { ...previous.bestByLevel };
  const nextBestTime = { ...previous.bestTimeByLevel };
  let selectedLevels = state.selectedLevels;
  let challengeRuns = state.challengeRuns;
  let freeRuns = state.freeRuns;
  let challengeAttemptRun: ChallengeRun | null = null;
  if (levelModeFor(game, state) === "challenge") {
    const expectedLevel = challengeNextLevel(game, state);
    if (expectedLevel && levelIDsMatch(game, expectedLevel.id, levelID)) {
      const previousRun = challengeRunFor(game, state) || emptyChallengeRun(difficulty);
      challengeAttemptRun = {
        ...previousRun,
        difficulty,
        attemptCount: Math.max(0, previousRun.attemptCount || 0) + 1,
      };
      challengeRuns = {
        ...challengeRuns,
        [game.id]: challengeAttemptRun,
      };
    }
  }
  if (levelModeFor(game, state) === "free") {
    const previousRun = freeRunFor(game, state) || emptyFreeRun(state.sessionId);
    freeRuns = {
      ...freeRuns,
      [game.id]: {
        ...previousRun,
        sessionId: state.sessionId || previousRun.sessionId,
        totalElapsedMillis: previousRun.totalElapsedMillis + Math.max(0, elapsedMillis || 0),
      },
    };
  }
  if (success) {
    nextBest[levelID] = higherDifficulty(nextBest[levelID], difficulty);
    if (elapsedMillis > 0 && (!nextBestTime[levelID] || elapsedMillis < nextBestTime[levelID])) {
      nextBestTime[levelID] = elapsedMillis;
    }

    const difficultyLevels = levelsForDifficulty(game, difficulty);
    if (levelModeFor(game, state) === "free") {
      const finishedIndex = difficultyLevels.findIndex((level) => level.id === levelID);
      const nextLevel = finishedIndex >= 0 ? difficultyLevels[finishedIndex + 1] : null;
      if (nextLevel) {
        selectedLevels = {
          ...selectedLevels,
          [game.id]: nextLevel.id,
        };
      }
    } else if (levelModeFor(game, state) === "challenge") {
      if (challengeAttemptRun) {
        const completedLevels = {
          ...challengeAttemptRun.completedLevels,
          [levelID]: Math.max(0, elapsedMillis || 0),
        };
        const nextRun: ChallengeRun = {
          ...challengeAttemptRun,
          difficulty,
          completedLevels,
          totalElapsedMillis: challengeTotalElapsed(completedLevels),
        };
        const nextLevel = difficultyLevels.find((level) => !completedLevels[level.id]);
        if (nextLevel) {
          challengeRuns = {
            ...challengeRuns,
            [game.id]: nextRun,
          };
          selectedLevels = {
            ...selectedLevels,
            [game.id]: nextLevel.id,
          };
        } else {
          const { [game.id]: _completedRun, ...remainingRuns } = challengeRuns;
          challengeRuns = remainingRuns;
          selectedLevels = {
            ...selectedLevels,
            [game.id]: defaultLevelIDForDifficulty(game, difficulty),
          };
        }
      }
    }
  }
  return {
    ...state,
    selectedLevels,
    challengeRuns,
    freeRuns,
    levelProgress: {
      ...state.levelProgress,
      [game.id]: {
        unlockedThrough: success ? Math.min(game.levels.length, Math.max(previous.unlockedThrough || 1, finishedNumber + 1)) : previous.unlockedThrough,
        bestByLevel: nextBest,
        bestTimeByLevel: nextBestTime,
      },
    },
  };
}

function challengeCompletionForAttempt(
  state: MenuState,
  game: GameCard,
  levelID: string,
  success: boolean,
  difficulty: DifficultyID,
  elapsedMillis: number,
): ChallengeCompletion | null {
  if (!success || !game.levels?.length || levelModeFor(game, state) !== "challenge") return null;
  const expectedLevel = challengeNextLevel(game, state);
  if (!expectedLevel || !levelIDsMatch(game, expectedLevel.id, levelID)) return null;
  const previousRun = challengeRunFor(game, state) || emptyChallengeRun(difficulty);
  const difficultyLevels = levelsForDifficulty(game, difficulty);
  const completedLevels = {
    ...previousRun.completedLevels,
    [levelID]: Math.max(0, elapsedMillis || 0),
  };
  if (!difficultyLevels.every((level) => completedLevels[level.id] !== undefined)) return null;
  const totalElapsedMillis = challengeTotalElapsed(completedLevels);
  return {
    key: `${state.sessionId || "local"}:${game.id}:${difficulty}:${difficultyLevels.length}:${totalElapsedMillis}`,
    difficulty,
    gameID: game.id,
    gameLabel: game.label,
    revisionHash: game.revisionHash || null,
    levelCount: difficultyLevels.length,
    totalElapsedMillis,
  };
}

function normalizeLevelModes(value: unknown): Record<string, LevelMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, LevelMode] => typeof entry[0] === "string" && (entry[1] === "challenge" || entry[1] === "free")),
  );
}

function normalizeChallengeRuns(value: unknown): Record<string, ChallengeRun> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const runs: Record<string, ChallengeRun> = {};
  for (const [gameID, run] of Object.entries(value as Record<string, unknown>)) {
    if (!run || typeof run !== "object" || Array.isArray(run)) continue;
    const source = run as Partial<ChallengeRun>;
    const completedLevels = source.completedLevels && typeof source.completedLevels === "object" && !Array.isArray(source.completedLevels)
      ? Object.fromEntries(
          Object.entries(source.completedLevels)
            .map(([levelID, elapsed]) => [levelID, Math.max(0, Math.round(Number(elapsed) || 0))]),
        )
      : {};
    runs[gameID] = {
      difficulty: difficulties.some((candidate) => candidate.id === source.difficulty) ? (source.difficulty as DifficultyID) : "easy",
      startedUnixMillis: Math.max(0, Math.round(Number(source.startedUnixMillis) || 0)),
      completedLevels,
      totalElapsedMillis: challengeTotalElapsed(completedLevels),
      attemptCount: Math.max(Object.keys(completedLevels).length, Math.round(Number(source.attemptCount) || 0)),
    };
  }
  return runs;
}

function normalizeFreeRuns(value: unknown): Record<string, FreeRun> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const runs: Record<string, FreeRun> = {};
  for (const [gameID, run] of Object.entries(value as Record<string, unknown>)) {
    if (!run || typeof run !== "object" || Array.isArray(run)) continue;
    const source = run as Partial<FreeRun>;
    runs[gameID] = {
      sessionId: typeof source.sessionId === "string" ? source.sessionId : "",
      startedUnixMillis: Math.max(0, Math.round(Number(source.startedUnixMillis) || 0)),
      totalElapsedMillis: Math.max(0, Math.round(Number(source.totalElapsedMillis) || 0)),
    };
  }
  return runs;
}

function normalizeGameConfigState(value: unknown): Record<string, GameConfigValues> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state: Record<string, GameConfigValues> = {};
  for (const [gameID, overrides] of Object.entries(value as Record<string, unknown>)) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) continue;
    const clean: GameConfigValues = {};
    for (const [key, raw] of Object.entries(overrides as Record<string, unknown>)) {
      if (!key.trim()) continue;
      if (typeof raw === "boolean" || typeof raw === "string") clean[key] = raw;
      else if (typeof raw === "number" && Number.isFinite(raw)) clean[key] = raw;
    }
    if (Object.keys(clean).length) state[gameID] = clean;
  }
  return state;
}

// Overrides the players chose for a game's player-facing variables; only keys
// the current catalog still declares are sent with the launch request.
function menuConfigOverridesFor(game: Pick<GameCard, "id" | "configVars">, menu: MenuState): GameConfigValues | undefined {
  const vars = game.configVars;
  const stored = menu.gameConfig[game.id];
  if (!vars?.length || !stored) return undefined;
  const overrides: GameConfigValues = {};
  for (const item of vars) {
    const value = stored[item.key];
    if (value === undefined || value === item.default) continue;
    overrides[item.key] = value;
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

function configVarValue(item: GameConfigVar, overrides: GameConfigValues | undefined): number | boolean | string | undefined {
  const stored = overrides?.[item.key];
  if (stored !== undefined) return stored;
  return item.default;
}

function defaultMenuState(): MenuState {
  return {
    sessionActive: false,
    sessionId: "",
    sessionStartedUnix: 0,
    recordingEnabled: true,
    recordingPolicy: "visit",
    teamName: "",
    players: defaultPlayers,
    category: "featured",
    selectedGame: "",
    difficulty: "easy",
    selectedLevels: {},
    levelModes: {},
    levelProgress: {},
    challengeRuns: {},
    freeRuns: {},
    nextPlayerId: 1,
    narrationArmed: {},
    operatorUnlockLevels: envUnlockLevels,
    gameConfig: {},
    processedAttemptIDs: [],
  };
}

function loadMenuState(): MenuState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as Partial<MenuState> | null;
    if (saved && typeof saved === "object") {
      const narrationArmed = saved.narrationArmed && typeof saved.narrationArmed === "object" ? saved.narrationArmed : {};
      const selectedLevels = saved.selectedLevels && typeof saved.selectedLevels === "object" ? saved.selectedLevels : {};
      const levelModes = normalizeLevelModes(saved.levelModes);
      const levelProgress = saved.levelProgress && typeof saved.levelProgress === "object" ? saved.levelProgress : {};
      const challengeRuns = normalizeChallengeRuns(saved.challengeRuns);
      const freeRuns = normalizeFreeRuns(saved.freeRuns);
      const hasSavedPlayers = Array.isArray(saved.players);
      const savedPlayers = hasSavedPlayers ? saved.players as Player[] : [];
      const cleanedPlayers = savedPlayers.map((player, index) => ({
        id: Number(player?.id) || index + 1,
        name: cleanNameWhitespace(String(player?.name || ""), maxPlayerNameLength),
        color: typeof player?.color === "string" ? player.color : playerColors[index % playerColors.length],
        active: Boolean(player?.active),
      }));
      // Live catalog IDs are revision-matched and may not exist in the static
      // offline fallback. Preserve the requested ID until catalog hydration.
      const requestedGameID = String(saved.selectedGame || "");
      const savedCategory: CategoryID = categories.some((category) => category.id === saved.category) ? (saved.category as CategoryID) : "featured";
      const savedDifficulty = difficulties.some((candidate) => candidate.id === saved.difficulty)
        ? (saved.difficulty as DifficultyID)
        : "easy";
      const recordingPolicy = normalizeRecordingScope(saved.recordingPolicy, saved.recordingEnabled);
      return {
        sessionActive: Boolean(saved.sessionActive),
        sessionId: isUUID(saved.sessionId) ? saved.sessionId.toLowerCase() : "",
        sessionStartedUnix: Number(saved.sessionStartedUnix) || 0,
        recordingEnabled: recordingPolicy !== "off",
        recordingPolicy,
        teamName: cleanNameWhitespace(String(saved.teamName || ""), maxTeamNameLength),
        players: hasSavedPlayers ? cleanedPlayers : defaultPlayers,
        category: savedCategory,
        selectedGame: requestedGameID,
        difficulty: savedDifficulty,
        selectedLevels,
        levelModes,
        levelProgress,
        challengeRuns,
        freeRuns,
        nextPlayerId: saved.nextPlayerId || cleanedPlayers.length || 1,
        narrationArmed,
        operatorUnlockLevels: envUnlockLevels || Boolean(saved.operatorUnlockLevels),
        gameConfig: normalizeGameConfigState(saved.gameConfig),
        processedAttemptIDs: Array.isArray(saved.processedAttemptIDs)
          ? saved.processedAttemptIDs.filter((value): value is string => typeof value === "string" && value.length > 0).slice(-maxProcessedAttemptIDs)
          : [],
      };
    }
  } catch {
    // Ignore broken local storage and return the default kiosk state.
  }
  return defaultMenuState();
}

function clearedMenuSession(current: MenuState, defaultGame: GameCard): MenuState {
  const defaultSelectedLevels = defaultGame.levels?.length ? { [defaultGame.id]: defaultLevelID(defaultGame) } : {};
  return {
    ...current,
    ...clearedVenueSessionProjection(defaultPlayers),
    recordingEnabled: current.recordingPolicy !== "off",
    recordingPolicy: current.recordingPolicy,
    category: menuCategoryForGame(defaultGame, "featured"),
    selectedGame: defaultGame.id,
    difficulty: "easy",
    selectedLevels: defaultSelectedLevels,
    levelModes: current.levelModes,
  };
}

export function normalizeRecordingScope(value: unknown, legacyEnabled?: unknown): RecordingScope {
  if (value === "off" || value === "visit" || value === "selection" || value === "run") return value;
  return legacyEnabled === false ? "off" : "visit";
}

function loadCachedPlatformCatalog(): PlatformGameCatalogEntry[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    for (const key of retiredStorageKeys) localStorage.removeItem(key);
  } catch {
    // Storage cleanup is best-effort.
  }
  try {
    const payload = JSON.parse(localStorage.getItem(platformCatalogStorageKey) || "null") as { games?: unknown } | PlatformGameCatalogEntry[] | null;
    const games = Array.isArray(payload) ? payload : Array.isArray(payload?.games) ? payload.games : null;
    return games ? games.filter(isPlatformGameCatalogEntry) : null;
  } catch {
    return null;
  }
}

function cachePlatformCatalog(catalog: PlatformGameCatalogEntry[]) {
  try {
    localStorage.setItem(platformCatalogStorageKey, JSON.stringify({ games: catalog, cachedAt: Date.now() }));
  } catch {
    // Ignore storage pressure; the bundled catalog remains the offline fallback.
  }
}

function loadPartyRun(): PartyRunState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(partyRunStorageKey) || "null") as Partial<PartyRunState> | null;
    if (
      !value
      || typeof value.partyGameID !== "string"
      || typeof value.sessionId !== "string"
      || !Number.isFinite(value.index)
      || !Number.isFinite(value.cumulativeScore)
    ) return null;
    return {
      cumulativeScore: Math.max(0, Number(value.cumulativeScore)),
      index: Math.max(0, Math.floor(Number(value.index))),
      partyGameID: value.partyGameID,
      sessionId: value.sessionId,
    };
  } catch {
    return null;
  }
}

function loadVenueSessionObservation(): VenueSessionObservation | null {
  try {
    const saved = JSON.parse(localStorage.getItem(venueSessionObservationStorageKey) || "null") as Partial<VenueSessionObservation> | null;
    if (!saved || typeof saved !== "object") return null;
    const runId = typeof saved.runId === "string" ? saved.runId : "";
    const venueSessionId = typeof saved.venueSessionId === "string" ? saved.venueSessionId : "";
    return runId ? { runId, venueSessionId } : null;
  } catch {
    return null;
  }
}

function persistVenueSessionObservation(observation: VenueSessionObservation) {
  try {
    localStorage.setItem(venueSessionObservationStorageKey, JSON.stringify(observation));
  } catch {
    // Recovery metadata is best-effort; the live runtime remains authoritative.
  }
}

function isPlatformGameCatalogEntry(value: unknown): value is PlatformGameCatalogEntry {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "id" in value && "label" in value);
}

// Players get a "Jugador N" placeholder until they are named.
function menuSnapshotProperties(menu: MenuState) {
  return {
    team_name: menu.teamName.trim(),
    recording_enabled: menu.recordingEnabled,
    recording_scope: menu.recordingPolicy,
    players: rosterSnapshot(menu.players),
    player_count: menu.players.filter((player) => player.active).length,
  };
}

export default function App() {
  return floorOnlyFromURL() ? <FloorOnlyApp /> : <MenuApp />;
}

function MenuApp() {
  const menuAccess = useMemo(
    () => menuAccessPolicyFromSearch(typeof window === "undefined" ? "" : window.location.search),
    []
  );
  const readOnlyMirror = menuAccess.readOnly;
  const followsMenuMirror = menuAccess.followMirror;
  const localPlayground = useMemo(() => localPlaygroundEnabled(), []);
  const [menu, setMenu] = useState<MenuState>(() => menuAccess.persistLocalState ? loadMenuState() : defaultMenuState());
  const [status, setStatus] = useState<PlayerMenuEngineStatus | null>(null);
  const statusGate = useRef(new PlayerExperienceStateGate());
  const acceptStatus = useCallback((next: PlayerMenuEngineStatus) => {
    setStatus((current) => statusGate.current.accepts(current, next) ? next : current);
  }, []);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connection-pending");
  const [platformCatalog, setPlatformCatalog] = useState<PlatformGameCatalogEntry[] | null>(() => loadCachedPlatformCatalog());
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(() => platformBaseURL() !== "" && platformCatalog === null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [keyboardTarget, setKeyboardTarget] = useState<KeyboardTarget | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [confirmResetSession, setConfirmResetSession] = useState(false);
  const [pendingLevelSwitch, setPendingLevelSwitch] = useState<{ gameID: string; levelID: string } | null>(null);
  const [pendingGameControl, setPendingGameControl] = useState<"exit" | "restart" | null>(null);
  const [recordingScopeSaving, setRecordingScopeSaving] = useState(false);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [gameConfigOpen, setGameConfigOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const [settingsPin, setSettingsPin] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsPinFailures, setSettingsPinFailures] = useState(0);
  const [settingsLockoutUntil, setSettingsLockoutUntil] = useState(0);
  const [teamOpen, setTeamOpen] = useState(false);
  // This fallback exists only before the first engine snapshot (and in the
  // read-only mirror). Once connected, canonical runtime state owns routing.
  const [fallbackScreenMode, setScreenMode] = useState<ScreenMode>("browse");
  const screenMode = status ? playerExperienceView(status).screen : fallbackScreenMode;
  const [remoteSessionRequest, setRemoteSessionRequest] = useState<RemoteSessionRequest | null>(() => remoteSessionRequestFromURL());
  const [launchingGameID, setLaunchingGameID] = useState<string | null>(null);
  const [pendingControlAction, setPendingControlAction] = useState<ControlGameAction | null>(null);
  const [activeLevelLaunch, setActiveLevelLaunch] = useState<ActiveLevelLaunch | null>(null);
  const [levelBrowserGameID, setLevelBrowserGameID] = useState<string | null>(null);
  const [partyRun, setPartyRun] = useState<PartyRunState | null>(() => {
    if (!menuAccess.persistLocalState) return null;
    const saved = loadPartyRun();
    return saved?.sessionId && saved.sessionId === menu.sessionId ? saved : null;
  });
  const processedFinishedSessions = useRef(new Set<string>(menu.processedAttemptIDs));
  const reportedGameStartedSessions = useRef(new Set<string>());
  const processedChallengeCompletions = useRef(new Set<string>());
  const processedPartyFinishes = useRef(new Set<string>());
  const catalogRefreshInFlight = useRef(false);
  const catalogRefreshDelayRef = useRef(platformCatalogRefreshMillis);
  const platformCatalogRef = useRef(platformCatalog);
  const reconciledPlatformCatalogSignatureRef = useRef("");
  const syncedEngineSession = useRef("");
  const mirroredMenuVersion = useRef(0);
  const mirroredMenuUpdatedUnixMillis = useRef(0);
  const venueSessionObservationRef = useRef<VenueSessionObservation | null>(
    menuAccess.persistLocalState ? loadVenueSessionObservation() : null
  );
  const venueSessionIDRef = useRef(menu.sessionId);
  const launchInFlightRef = useRef(false);
  const controlInFlightRef = useRef(false);
  const levelSwitchInFlightRef = useRef(false);
  const sessionStartInFlightRef = useRef(false);
  const sessionCloseInFlightRef = useRef(false);
  const recordingScopeChangeInFlightRef = useRef(false);
  const nameEditStartRef = useRef<{ target: KeyboardTarget; value: string } | null>(null);
  const touchKeyboardTargetRef = useRef<KeyboardTarget | null>(null);
  const teamTriggerRef = useRef<HTMLButtonElement>(null);
  const teamCloseRef = useRef<HTMLButtonElement>(null);
  const teamDrawerFocusFallback = useCallback(() => teamCloseRef.current, []);
  const teamWasOpenRef = useRef(false);
  const [menuMirrorReady, setMenuMirrorReady] = useState(!followsMenuMirror);

  useEffect(() => {
    if (!menuAccess.persistLocalState) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(menu));
    } catch {
      // Storage is a convenience, never a reason for the kiosk to stop working.
    }
  }, [menu, menuAccess.persistLocalState]);

  useEffect(() => {
    if (!menuAccess.persistLocalState) return;
    try {
      if (partyRun) localStorage.setItem(partyRunStorageKey, JSON.stringify(partyRun));
      else localStorage.removeItem(partyRunStorageKey);
    } catch {
      // The Party still runs in memory if kiosk storage is unavailable.
    }
  }, [partyRun, menuAccess.persistLocalState]);

  useEffect(() => {
    venueSessionIDRef.current = menu.sessionId;
  }, [menu.sessionId]);

  const menuRef = useRef(menu);

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

  useEffect(() => {
    if (!keyboardTarget) touchKeyboardTargetRef.current = null;
  }, [keyboardTarget]);

  useEffect(() => {
    for (const attemptID of menu.processedAttemptIDs) processedFinishedSessions.current.add(attemptID);
  }, [menu.processedAttemptIDs]);

  useEffect(() => {
    const wasOpen = teamWasOpenRef.current;
    teamWasOpenRef.current = teamOpen;
    const frame = window.requestAnimationFrame(() => {
      if (teamOpen) teamCloseRef.current?.focus({ preventScroll: true });
      else if (wasOpen) teamTriggerRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [teamOpen]);

  useEffect(() => {
    platformCatalogRef.current = platformCatalog;
  }, [platformCatalog]);

  const refreshPlatformCatalog = useCallback(async (options: { manual?: boolean } = {}) => {
    if (catalogRefreshInFlight.current) return false;
    catalogRefreshInFlight.current = true;
    if (options.manual || platformCatalogRef.current === null) setCatalogRefreshing(true);
    if (platformCatalogRef.current === null) setCatalogLoading(true);
    try {
      const next = await fetchGameCatalog();
      cachePlatformCatalog(next);
      setPlatformCatalog(next);
      catalogRefreshDelayRef.current = platformCatalogRefreshMillis;
      if (options.manual) {
        const selectedID = menuRef.current.selectedGame;
        const selected = next.find((entry) => entry.id === selectedID);
        setError("");
        setMessage("Catálogo actualizado");
        captureMenuEvent("catalog_refreshed", {
          game: selectedID,
          game_revision: selected?.revision_hash,
          previous_revision: platformCatalogRef.current?.find((entry) => entry.id === selectedID)?.revision_hash,
        });
      }
      return true;
    } catch {
      catalogRefreshDelayRef.current = Math.min(platformCatalogRefreshMaxMillis, catalogRefreshDelayRef.current * 2);
      if (options.manual) setError("No se pudo actualizar el catálogo");
      return false;
    } finally {
      catalogRefreshInFlight.current = false;
      setCatalogRefreshing(false);
      setCatalogLoading(false);
    }
  }, []);

  const menuGames = useMemo(() => {
    const bundledGames = bundledProductionGameCards();
    const platformAnimations = platformAnimationCards(platformCatalog);
    return applyPlatformCatalog(
      [...bundledGames, ...platformAnimations, ...liveAnimationCards(status?.catalog, [...bundledGames, ...platformAnimations])],
      platformCatalog,
      status?.catalog,
    );
  }, [platformCatalog, status?.catalog]);

  useEffect(() => {
    if (!platformCatalog || !menuGames.length) return;
    setMenu((current) => migrateLegacyLevelState(current, menuGames));
  }, [menuGames, platformCatalog]);

  useEffect(() => {
    if (!platformCatalog || !menuGames.length) return;
    const catalogSignature = platformCatalogMenuSignature(platformCatalog);
    const catalogChanged = reconciledPlatformCatalogSignatureRef.current !== catalogSignature;
    reconciledPlatformCatalogSignatureRef.current = catalogSignature;
    const selectedGameToPreserve = catalogChanged ? menuRef.current.selectedGame : "";
    setMenu((current) => {
      const categoryGames = gamesForCategory(menuGames, current.category);
      const preservedSelection = selectedGameToPreserve
        ? gameForMenuIdentity(menuGames, selectedGameToPreserve)
        : undefined;
      // An empty category is a valid catalog view. Keep it selected so the
      // recovery surface remains stable instead of snapping back to the stale
      // game that happened to be selected in the previous category.
      if (!preservedSelection && categoryGames.length === 0) return current;
      const selected = preservedSelection
        || gameForMenuIdentity(categoryGames, current.selectedGame)
        || categoryGames[0];
      const category = preservedSelection ? menuCategoryForGame(selected, current.category) : current.category;
      const difficulty = normalizedDifficultyForGame(selected, current.difficulty);
      const levelID = selected.levels?.length
        ? closestLevelIDForDifficulty(selected, current.selectedLevels[selected.id] || defaultLevelIDForDifficulty(selected, difficulty), difficulty)
        : "";
      const selectedLevels = selected.levels?.length && current.selectedLevels[selected.id] !== levelID
        ? { ...current.selectedLevels, [selected.id]: levelID }
        : current.selectedLevels;
      if (
        current.selectedGame === selected.id
        && current.category === category
        && current.difficulty === difficulty
        && current.selectedLevels === selectedLevels
      ) {
        return current;
      }
      return {
        ...current,
        category,
        difficulty,
        selectedGame: selected.id,
        selectedLevels,
      };
    });
  }, [menu.category, menu.selectedGame, menuGames, platformCatalog]);

  // Mirror every captured menu event to the game-engine so the visit is fully
  // recorded server-side (independent of PostHog analytics).
  useEffect(() => {
    if (readOnlyMirror) return;
    setMenuEventForwarder((event, properties) => {
      const current = menuRef.current;
      const venueSessionId = venueSessionIDRef.current
        || (typeof properties.venue_session_id === "string" ? properties.venue_session_id : "");
      if (!venueSessionId) return;
      postMenuEvent({
        venueSessionId,
        name: event,
        kioskId: menuKioskID(),
        occurredAtUnixMillis: Date.now(),
        properties: {
          ...menuSnapshotProperties(current),
          ...properties,
        },
      });
    });
    return () => setMenuEventForwarder(null);
  }, [readOnlyMirror]);

  useEffect(() => {
    if (!menuAccess.publishMirror || !status?.sessionId) return;
    if (!recordingGateAllowsGameStarted(status)) return;
    if (playerExperienceView(status).screen !== "game") return;
    if (reportedGameStartedSessions.current.has(status.sessionId)) return;

    // Keep this acknowledgement renderer-local: accepted engine revisions are
    // idempotent for one mount, but no optimistic launch survives a reload.
    reportedGameStartedSessions.current.add(status.sessionId);
    recordMenuEvent("game_started");
  }, [menuAccess.publishMirror, status]);

  useEffect(() => {
    if (!menuAccess.publishMirror) return;
    const snapshot: MenuMirrorSnapshot = {
      menu,
    };
    const timeout = window.setTimeout(() => {
      postMenuState({ kioskId: menuKioskID(), snapshot });
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [menu, menuAccess.publishMirror]);

  useEffect(() => {
    if (!followsMenuMirror) return;
    let cancelled = false;
    let nextRefresh: number | undefined;

    function applyEnvelope(envelope: MenuStateEnvelope<MenuMirrorSnapshot>) {
      if (cancelled) return;
      const resolved = resolveMenuMirrorEnvelope(
        envelope,
        mirroredMenuVersion.current,
        mirroredMenuUpdatedUnixMillis.current
      );
      setMenuMirrorReady(resolved.ready);
      if (!resolved.accepted || !resolved.snapshot) return;
      mirroredMenuVersion.current = resolved.version;
      mirroredMenuUpdatedUnixMillis.current = resolved.updatedUnixMillis;
      const snapshot = resolved.snapshot;
      setMenu({ ...snapshot.menu, processedAttemptIDs: snapshot.menu.processedAttemptIDs || [] });
      setKeyboardTarget(null);
      setColorPickerFor(null);
      setConfirmRemove(null);
      setConfirmResetSession(false);
      setPendingLevelSwitch(null);
      setSettingsOpen(false);
    }

    async function refreshMenuState() {
      try {
        const envelope = await fetchMenuState<MenuMirrorSnapshot>();
        if (!cancelled) {
          setError((current) => current === "Sin conexión con el menú principal" ? "" : current);
          applyEnvelope(envelope);
        }
      } catch {
        if (!cancelled) setError("Sin conexión con el menú principal");
      } finally {
        if (!cancelled) nextRefresh = window.setTimeout(refreshMenuState, 700);
      }
    }

    void refreshMenuState();
    return () => {
      cancelled = true;
      if (nextRefresh !== undefined) window.clearTimeout(nextRefresh);
    };
  }, [followsMenuMirror]);

  useEffect(() => {
    let cancelled = false;
    let nextRefresh: number | undefined;
    let source: EventSource | null = null;
    let streamFreshAt = 0;
    const accept = (next: PlayerMenuEngineStatus) => {
      if (cancelled) return;
      acceptStatus(next);
      setConnectionState("connection-on");
    };
    const attach = () => {
      if (localPlayground) return;
      source?.close();
      source = playerExperienceEventSource();
      source.addEventListener("player-state", (event) => {
        try {
          streamFreshAt = Date.now();
          accept(JSON.parse((event as MessageEvent).data) as PlayerMenuEngineStatus);
        } catch {
          // A malformed event cannot replace the last accepted revision.
        }
      });
      source.onerror = () => {
        if (!cancelled) setConnectionState("connection-pending");
      };
    };
    async function refresh() {
      try {
        const next = await fetchEngineStatus();
        accept(next);
      } catch {
        if (!cancelled) setConnectionState("connection-off");
      } finally {
        if (!cancelled) {
          if (!localPlayground && Date.now() - streamFreshAt > 5_000 && source?.readyState === EventSource.CLOSED) attach();
          nextRefresh = window.setTimeout(refresh, 2500);
        }
      }
    }
    attach();
    void refresh();
    return () => {
      cancelled = true;
      source?.close();
      if (nextRefresh !== undefined) window.clearTimeout(nextRefresh);
    };
  }, [acceptStatus, localPlayground]);

  useEffect(() => {
    let cancelled = false;
    let nextRefresh: number | undefined;
    async function refreshCatalog() {
      if (cancelled) return;
      await refreshPlatformCatalog();
      if (!cancelled) nextRefresh = window.setTimeout(refreshCatalog, catalogRefreshDelayRef.current);
    }
    const refreshOnDemand = () => { void refreshPlatformCatalog(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshPlatformCatalog();
    };
    void refreshCatalog();
    window.addEventListener("motion-levels:refresh-catalog", refreshOnDemand);
    window.addEventListener("focus", refreshOnDemand);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      if (nextRefresh !== undefined) window.clearTimeout(nextRefresh);
      window.removeEventListener("motion-levels:refresh-catalog", refreshOnDemand);
      window.removeEventListener("focus", refreshOnDemand);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshPlatformCatalog]);

  useEffect(() => {
    if (screenMode !== "browse" || !message) return;
    const timeout = window.setTimeout(() => {
      setMessage((current) => (current === message ? "" : current));
    }, 4_000);
    return () => window.clearTimeout(timeout);
  }, [message, screenMode]);

  useEffect(() => {
    if (!menu.sessionActive) return;
    const latestActivityUnix = Math.max(menu.sessionStartedUnix || 0, status?.lastPressureUnix || 0);
    if (!latestActivityUnix) return;
    const idleMillis = Math.max(0, Date.now() - latestActivityUnix * 1000);
    const remainingMillis = Math.max(0, noPressureSessionLimitMillis - idleMillis);
    const timeout = window.setTimeout(() => {
      void closeSession("no_pressure_1h");
    }, remainingMillis);
    return () => window.clearTimeout(timeout);
  }, [menu.sessionActive, menu.sessionStartedUnix, status?.lastPressureUnix]);

  useEffect(() => {
    // The embedded playground intentionally has no canonical venue-session
    // service. Its synthetic idle snapshot must not close the local menu state.
    if (!status || !menuAccess.publishMirror || localPlayground) return;
    const decision = venueSessionSyncDecision(status, venueSessionObservationRef.current, menu);
    venueSessionObservationRef.current = decision.observation;
    persistVenueSessionObservation(decision.observation);
    const defaultGame = menuGames[0] || games[0];

    if (decision.action === "hydrate") {
      const recordingPolicy = venueSessionRecordingScope(status, menu.recordingPolicy);
      setMenu((current) => ({
        ...current,
        sessionActive: true,
        sessionId: status.venueSessionId,
        sessionStartedUnix: status.venueSessionStartedUnix || current.sessionStartedUnix || Math.floor(Date.now() / 1_000),
        recordingEnabled: recordingPolicy !== "off",
        recordingPolicy,
        teamName: status.teamName || current.teamName || defaultTeamName(),
      }));
      return;
    }

    if (decision.action === "clear") {
      setMenu((current) => clearedMenuSession(current, defaultGame));
      setPartyRun(null);
      setTeamOpen(false);
      setKeyboardTarget(null);
      setColorPickerFor(null);
      setConfirmRemove(null);
      setConfirmResetSession(false);
      setPendingLevelSwitch(null);
      setLevelBrowserGameID(null);
      setScreenMode("browse");
      return;
    }

    if (decision.action !== "recover") return;
    let cancelled = false;
    let retry: number | undefined;
    const recover = async () => {
      try {
        const recovered = await postVenueSession({
          action: "start",
          venueSessionId: menu.sessionId,
          teamName: menu.teamName,
          recordingEnabled: menu.recordingEnabled,
          recordingPolicy: { scope: menu.recordingPolicy },
          kioskId: menuKioskID(),
        });
        if (!cancelled && recovered) acceptStatus(recovered);
      } catch {
        if (!cancelled) retry = window.setTimeout(recover, 2_500);
      }
    };
    void recover();
    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [acceptStatus, localPlayground, menu.sessionActive, menu.sessionId, menu.sessionStartedUnix, menu.teamName, menu.recordingEnabled, menu.recordingPolicy, menuAccess.publishMirror, menuGames, status]);

  useEffect(() => {
    if (!status) return;
    const engineGame = gameForEngineStatus(status.currentGame, menu.selectedGame, menuGames);
    if (!engineGame) return;

    const engineIsAmbient = isAmbientCard(engineGame);
    const engineIsIdleLoop = animationIsIdleLoop(status.currentGame, status.phase);
    const syncKey = `${status.sessionId}:${status.currentGame}:${status.level || ""}:${status.phase}`;

    if (engineIsIdleLoop) {
      syncedEngineSession.current = syncKey;
      return;
    }

    if (!menu.sessionActive) {
      const recordingPolicy = venueSessionRecordingScope(status, menu.recordingPolicy);
      setMenu((current) => ({
        ...current,
        sessionActive: true,
        sessionId: current.sessionId || status.venueSessionId || newVenueSessionID(),
        sessionStartedUnix: current.sessionStartedUnix || status.startedUnix || Math.floor(Date.now() / 1000),
        recordingEnabled: status.venueSessionId ? recordingPolicy !== "off" : current.recordingEnabled !== false,
        recordingPolicy: status.venueSessionId ? recordingPolicy : current.recordingPolicy,
        teamName: current.teamName || status.teamName || defaultTeamName(),
      }));
    }

    setMenu((current) => {
      const engineDifficulty = usesDifficulty(engineGame) ? normalizedDifficultyForGame(engineGame, difficultyFromEngine(status.difficulty, current.difficulty)) : current.difficulty;
      const canonicalStatusLevel = canonicalLevelID(engineGame, status.level || "", engineDifficulty);
      const statusLevel = canonicalStatusLevel && levelSupportsDifficulty(engineGame, logicalLevelForGame(engineGame, canonicalStatusLevel), engineDifficulty)
        ? canonicalStatusLevel
        : "";
      const nextLevelID = engineGame.levels?.length
        ? closestLevelIDForDifficulty(engineGame, statusLevel || current.selectedLevels[engineGame.id] || defaultLevelIDForDifficulty(engineGame, engineDifficulty), engineDifficulty)
        : "";
      const selectedLevels = engineGame.levels?.length && current.selectedLevels[engineGame.id] !== nextLevelID ? { ...current.selectedLevels, [engineGame.id]: nextLevelID } : current.selectedLevels;
      const progress = progressFor(engineGame, current);
      const syncedLevelNumber = status.level ? levelNumberForGame(engineGame, status.level) : 0;
      const levelProgress =
        engineGame.levels?.length && status.level && progress.unlockedThrough < syncedLevelNumber
          ? {
              ...current.levelProgress,
              [engineGame.id]: {
                ...progress,
                unlockedThrough: syncedLevelNumber,
              },
            }
          : current.levelProgress;
      if (
        current.selectedGame === engineGame.id &&
        current.category === menuCategoryForGame(engineGame, current.category) &&
        current.difficulty === engineDifficulty &&
        current.selectedLevels === selectedLevels &&
        current.levelProgress === levelProgress
      ) {
        return current;
      }
      return {
        ...current,
        category: menuCategoryForGame(engineGame, current.category),
        selectedGame: engineGame.id,
        selectedLevels,
        levelProgress,
        difficulty: engineDifficulty,
      };
    });
    setLevelBrowserGameID(null);
    setTeamOpen(false);
    setKeyboardTarget(null);

    if (engineIsAmbient) {
      if (screenMode === "game") setScreenMode("browse");
      syncedEngineSession.current = syncKey;
      return;
    }

    if (screenMode !== "game") {
      setScreenMode("game");
      setMessage("En curso");
    }
    syncedEngineSession.current = syncKey;
  }, [status, menu.selectedGame, screenMode, menuGames]);

  useEffect(() => {
    if (screenMode !== "game") return;
    setTeamOpen(false);
    setKeyboardTarget(null);
    setColorPickerFor(null);
    setConfirmRemove(null);
    setConfirmResetSession(false);
    setPendingLevelSwitch(null);
  }, [screenMode]);

  useEffect(() => {
    if (!status?.sessionId || !menu.sessionId) return;
    if (status.venueSessionId !== menu.sessionId) return;
    const attempts: FinishedLevelAttempt[] = [...(status.finishedLevelAttempts || [])];
    if (status.phase === "finished") {
      const game = menuGames.find((candidate) => runtimeGameID(candidate) === status.currentGame || engineGameID(candidate) === status.currentGame);
      const finishedLevel = status.level || (game ? selectedLevelFor(game) : "");
      const alreadyHasAttempt = attempts.some((attempt) => attempt.game === status.currentGame && (game ? levelIDsMatch(game, attempt.level, finishedLevel) : attempt.level === finishedLevel));
      if (game?.levels?.length && finishedLevel && !alreadyHasAttempt) {
        attempts.push({
          attemptId: `${status.sessionId}:${status.currentGame}:${finishedLevel}:${status.success ? "success" : "failed"}:${status.elapsedMillis || 0}`,
          venueSessionId: status.venueSessionId,
          game: status.currentGame,
          level: finishedLevel,
          levelNumber: game ? levelNumberForGame(game, finishedLevel) : levelNumber(finishedLevel),
          difficulty: status.difficulty,
          result: status.success ? "success" : "failed",
          success: status.success,
          elapsedMillis: status.elapsedMillis || 0,
          endedUnixNanos: 0,
        });
      }
    }

    const pending = attempts
      .map((attempt) => ({ attempt, game: menuGames.find((candidate) => engineGameID(candidate) === attempt.game || runtimeGameID(candidate) === attempt.game) }))
      .filter(({ attempt, game }) => (
        game?.levels?.length
        && attempt.level
        && attempt.venueSessionId === menu.sessionId
        && !processedFinishedSessions.current.has(attempt.attemptId)
      ));
    if (pending.length === 0) return;

    const processedIDs = pending.map(({ attempt }) => attempt.attemptId);
    processedFinishedSessions.current = new Set(
      [...processedFinishedSessions.current, ...processedIDs].slice(-maxProcessedAttemptIDs),
    );
    setMenu((current) => {
      const nextMenu = pending.reduce((next, { attempt, game }) => {
        if (!game?.levels?.length) return next;
        const difficulty = difficultyFromEngine(attempt.difficulty, next.difficulty);
        const completion = challengeCompletionForAttempt(next, game, attempt.level, attempt.success, difficulty, attempt.elapsedMillis || 0);
        if (completion && !processedChallengeCompletions.current.has(completion.key)) {
          processedChallengeCompletions.current.add(completion.key);
          captureMenuEvent("challenge_completed", {
            difficulty: completion.difficulty,
            engine_game: engineGameID(game),
            game: completion.gameID,
            game_label: completion.gameLabel,
            game_revision: completion.revisionHash,
            level_count: completion.levelCount,
            revision_hash: completion.revisionHash,
            score: completion.totalElapsedMillis,
            score_kind: "time",
            total_elapsed_millis: completion.totalElapsedMillis,
            total_elapsed_seconds: Math.round(completion.totalElapsedMillis / 1000),
            venue_session_id: next.sessionId,
          });
        }
        return recordLevelCompletion(next, game, attempt.level, attempt.success, difficulty, attempt.elapsedMillis || 0);
      }, current);
      const processedAttemptIDs = [...new Set([...nextMenu.processedAttemptIDs, ...processedIDs])].slice(-maxProcessedAttemptIDs);
      return processedAttemptIDs.length === nextMenu.processedAttemptIDs.length
        && processedAttemptIDs.every((value, index) => value === nextMenu.processedAttemptIDs[index])
        ? nextMenu
        : { ...nextMenu, processedAttemptIDs };
    });
  }, [status, menu.sessionId, menuGames]);

  useEffect(() => {
    if (!partyRun || !status || status.phase !== "finished") return;
    const party = menuGames.find((game) => game.id === partyRun.partyGameID);
    if (!party?.partyMiniGames?.length) return;
    const currentMiniGame = partyLaunchGame(party, menuGames, partyRun.index);
    if (!currentMiniGame) {
      setPartyRun(null);
      setMessage("");
      setError("El siguiente juego del Party ya no está disponible");
      return;
    }
    if (runtimeGameID(currentMiniGame) !== status.currentGame && engineGameID(currentMiniGame) !== status.currentGame) return;
    const activeSession = status.venueSessionId || status.sessionId;
    if (partyRun.sessionId && activeSession && partyRun.sessionId !== activeSession) return;
    const finishKey = `${activeSession || status.sessionId}:${status.currentGame}:${status.level || ""}:${status.elapsedMillis || 0}:${partyRun.index}`;
    if (processedPartyFinishes.current.has(finishKey)) return;
    processedPartyFinishes.current.add(finishKey);

    const cumulativeScore = partyRun.cumulativeScore + scoreFromStatus(status);
    const nextIndex = partyRun.index + 1;
    if (nextIndex >= party.partyMiniGames.length) {
      setPartyRun(null);
      setMessage(`Party terminado · ${cumulativeScore} pts`);
      return;
    }

    setPartyRun({
      cumulativeScore,
      index: nextIndex,
      partyGameID: party.id,
      sessionId: partyRun.sessionId,
    });
    setMessage(`Party ${nextIndex + 1}/${party.partyMiniGames.length} · ${cumulativeScore} pts`);
    void launch(party.id, { partyIndex: nextIndex, partyScore: cumulativeScore });
  }, [partyRun, status, menuGames]);

  // Selecting another card dismisses the per-game settings dialog.
  useEffect(() => {
    setGameConfigOpen(false);
  }, [menu.selectedGame]);

  // Esc closes the topmost overlay (keyboard first, then dialogs, then the team drawer).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (keyboardTarget) finishNameEdit(keyboardTarget, true);
      else if (colorPickerFor !== null) setColorPickerFor(null);
      else if (confirmRemove !== null) setConfirmRemove(null);
      else if (confirmResetSession) setConfirmResetSession(false);
      else if (pendingLevelSwitch) setPendingLevelSwitch(null);
      else if (pendingGameControl) setPendingGameControl(null);
      else if (gameConfigOpen) setGameConfigOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (teamOpen) setTeamOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardTarget, colorPickerFor, confirmRemove, confirmResetSession, pendingLevelSwitch, pendingGameControl, gameConfigOpen, settingsOpen, teamOpen]);

  const availableGames = useMemo(() => new Set((status?.catalog || []).map((entry) => entry.game)), [status]);
  const isGameLaunchable = useCallback((game: GameCard) => {
    if (!status || connectionState !== "connection-on") return false;
    if (catalogLoading && isPlatformLaunchableSource(game) && !canLaunchWhileCatalogRefreshes(game)) return false;
    if (!partyCatalogIsComplete(game, menuGames)) return false;
    const launchGame = partyLaunchGame(game, menuGames);
    if (!launchGame) return false;
    if (!isSupportedRuntimeGame(launchGame)) return false;
    if (!isAmbientCard(launchGame) && status.pressureStreamConnected === false) return false;
    if (availableGames.has(runtimeGameID(launchGame)) || availableGames.has(engineGameID(launchGame))) return true;
    return false;
  }, [availableGames, catalogLoading, connectionState, menuGames, status]);
  const activePlayers = menu.players.filter((player) => player.active);
  const enginePlayers = statusPlayersForDisplay(status);
  const activeCategory = categories.find((category) => category.id === menu.category) || categories[0];
  const levelsUnlocked = unlockLevelsEnabled(menu);
  const visibleGames = gamesForCategory(menuGames, menu.category);
  const selectedGame = gameForMenuIdentity(menuGames, menu.selectedGame) || menuGames[0] || games[0];
  const categorySelectionValid = visibleGames.some((game) => game.id === selectedGame.id);
  const runtimeGame = status ? gameForEngineStatus(status.currentGame, menu.selectedGame, menuGames) : null;
  const launchedGame = runtimeGame && playerExperienceView(status).screen === "game" ? runtimeGame : selectedGame;
  const levelBrowserGame = menuGames.find((game) => game.id === levelBrowserGameID && gameBelongsToCategory(game, menu.category) && game.levels?.length) || null;
  const browsingLevels = Boolean(levelBrowserGame);
  const levelBrowserDifficulty = levelBrowserGame ? normalizedDifficultyForGame(levelBrowserGame, menu.difficulty) : menu.difficulty;
  const levelBrowserLevels = levelBrowserGame ? levelsForDifficulty(levelBrowserGame, levelBrowserDifficulty) : [];
  const selectedSupportedDifficulties = usesDifficulty(selectedGame) ? selectableDifficultiesForGame(selectedGame) : supportedDifficultiesFor(selectedGame);
  const effectiveDifficulty = closestSupportedDifficulty(menu.difficulty, selectedSupportedDifficulties);
  const selectedVisibleLevels = levelsForDifficulty(selectedGame, effectiveDifficulty);
  const selectedLevelID = selectedLevelFor(selectedGame);
  const selectedLevel = selectedVisibleLevels.find((level) => level.id === selectedLevelID) || logicalLevelForGame(selectedGame, selectedLevelID);
  const selectedLevelProgress = progressFor(selectedGame, menu);
  const selectedLevelMode = levelModeFor(selectedGame, menu);
  const selectedChallengeRun = challengeRunFor(selectedGame, menu);
  const selectedLevelIndex = selectedLevel && selectedVisibleLevels.length ? selectedVisibleLevels.findIndex((level) => level.id === selectedLevel.id) + 1 : 0;
  const selectedLevelDisplayLabel = playerLevelLabel(selectedLevel, selectedLevelIndex > 0 ? selectedLevelIndex - 1 : undefined);
  const selectedLevelBest = selectedLevel ? selectedLevelProgress.bestByLevel[selectedLevel.id] : undefined;
  const selectedLevelBestTime = selectedLevel ? selectedLevelProgress.bestTimeByLevel[selectedLevel.id] : undefined;
  const selectedLevelBestLabel = selectedLevelBestTime ? formatBestTime(selectedLevelBestTime) : selectedLevelBest ? difficulties.find((difficulty) => difficulty.id === selectedLevelBest)?.label || selectedLevelBest : "Sin superar";
  const selectedChallengeProgressLabel = selectedGame.levels?.length
    ? `${selectedVisibleLevels.filter((level) => selectedChallengeRun?.completedLevels[level.id] !== undefined).length}/${selectedVisibleLevels.length}`
    : "0/0";
  const launchedLevelMode = activeLevelModeFor(launchedGame, menu, status);
  const selectedPartyMiniGames = isPartyCard(selectedGame) ? selectedGame.partyMiniGames || [] : [];
  const selectedGameActive = Boolean(status) && (
    status?.currentGame === runtimeGameID(selectedGame)
    || status?.currentGame === engineGameID(selectedGame)
  );
  const levelDetail = Boolean(selectedGame.levels?.length && selectedLevel);
  const gameActive = screenMode === "game";
  const recordingGateBlocking = recordingGateBlocks(status?.recordingGate);
  const launchedPlayers = rosterForGame(launchedGame, activePlayers);
  const displayPlayers = gameActive && enginePlayers.length > 0 ? enginePlayers : launchedPlayers;
  const headerPlayers = gameActive && enginePlayers.length > 0 ? enginePlayers : activePlayers;
  const launchedLevel = logicalLevelForGame(launchedGame, status?.level || selectedLevelFor(launchedGame));
  const launchedSupportedDifficulties = launchedGame.levels?.length
    ? selectableDifficultiesForGame(launchedGame)
    : usesDifficulty(launchedGame) ? selectableDifficultiesForGame(launchedGame) : supportedDifficultiesFor(launchedGame, launchedLevel);
  const launchedDifficulty = closestSupportedDifficulty(menu.difficulty, launchedSupportedDifficulties);
  const launchedLevelActive = isLevelRuntimeActive(status, launchedGame);
  const activeLevelLaunchView = visibleActiveLevelLaunch({
    gameID: launchedGame.id,
    launch: activeLevelLaunch,
    screenMode,
  });
  const pendingLevelSwitchGame = pendingLevelSwitch ? menuGames.find((game) => game.id === pendingLevelSwitch.gameID) || null : null;
  const pendingLevelSwitchLevel = logicalLevelForGame(pendingLevelSwitchGame || undefined, pendingLevelSwitch?.levelID) || null;
  const pickerPlayer = menu.players.find((player) => player.id === colorPickerFor) || null;
  const removePlayer = menu.players.find((player) => player.id === confirmRemove) || null;
  const menuPlayerCount = activePlayers.length;
  const headerPlayerCount = headerPlayers.length;
  const playerCountLabel = `${headerPlayerCount} ${headerPlayerCount === 1 ? "jugador" : "jugadores"}`;
  const selectedGamePlayerRangeLabel = playerRangeLabel(selectedGame);
  const rosterIssue = useMemo(() => gameRosterIssue(selectedGame, menu.players), [selectedGame, menu.players]);
  const floorReady = status?.pressureStreamConnected !== false;
  const systemStatusClass = connectionState === "connection-on" && !floorReady ? "floor-off" : connectionState;
  const connectionLabel = systemStatusLabel(connectionState, floorReady);
  const engineLabel = engineStatusLabel(connectionState);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", colors.blue);
    document.documentElement.style.setProperty("--accent-rgb", hexToRGB(colors.blue));
  }, []);

  useEffect(() => {
    if (catalogLoading) return;
    setMenu((current) => {
      const currentCategoryGames = gamesForCategory(menuGames, current.category);
      if (!current.selectedGame && currentCategoryGames.length === 0) return current;
      const game = gameForMenuIdentity(menuGames, current.selectedGame) || selectedGame;
      const category = currentCategoryGames.length === 0
        ? current.category
        : menuCategoryForGame(game, current.category);
      const difficulty = normalizedDifficultyForGame(game, current.difficulty);
      const currentLevelID = game.levels?.length ? current.selectedLevels[game.id] || defaultLevelIDForDifficulty(game, difficulty) : "";
      const nextLevelID = game.levels?.length ? closestLevelIDForDifficulty(game, currentLevelID, difficulty) : "";
      const selectedLevels = game.levels?.length && current.selectedLevels[game.id] !== nextLevelID
        ? { ...current.selectedLevels, [game.id]: nextLevelID }
        : current.selectedLevels;
      if (
        current.selectedGame === game.id
        && current.category === category
        && current.difficulty === difficulty
        && selectedLevels === current.selectedLevels
      ) return current;
      return {
        ...current,
        category,
        selectedGame: game.id,
        difficulty,
        selectedLevels,
      };
    });
  }, [catalogLoading, menu.difficulty, menu.selectedGame, menu.selectedLevels, menuGames, selectedGame]);

  function addPlayer() {
    setError("");
    const previousPlayerCount = activePlayers.length;
    const nextPlayers = menu.players.length < maxPlayers
      ? [
          ...menu.players,
          {
            id: menu.nextPlayerId + 1,
            name: "",
            color: firstAvailableColor(menu.players),
            active: true,
          },
        ]
      : menu.players;
    setMenu((current) => {
      if (current.players.length >= maxPlayers) return current;
      return {
        ...current,
        players: [
          ...current.players,
          {
            id: current.nextPlayerId + 1,
            name: "",
            color: firstAvailableColor(current.players),
            active: true,
          },
        ],
        nextPlayerId: current.nextPlayerId + 1,
      };
    });
    if (menu.players.length < maxPlayers) {
      captureMenuEvent("player_added", {
        previous_player_count: previousPlayerCount,
        next_player_count: previousPlayerCount + 1,
        players: rosterSnapshot(nextPlayers),
      });
    }
  }

  function ensurePlayers(current: MenuState): MenuState {
    if (current.players.some((player) => player.active)) return current;
    return {
      ...current,
      players: [{ id: current.nextPlayerId + 1, name: "", color: playerColors[0], active: true }],
      nextPlayerId: current.nextPlayerId + 1,
    };
  }

  function updatePlayer(id: number, patch: Partial<Player>) {
    setError("");
    const requestedPatch = typeof patch.name === "string" ? { ...patch, name: cleanNameWhitespace(patch.name, maxPlayerNameLength) } : patch;
    const currentPlayer = menu.players.find((player) => player.id === id);
    const nextPlayers = currentPlayer
      ? menu.players.map((player) => (player.id === id ? { ...player, ...requestedPatch } : player))
      : menu.players;
    if (typeof requestedPatch.name === "string" && currentPlayer && requestedPatch.name !== currentPlayer.name) {
      captureMenuEvent("player_renamed", {
        player_index: menu.players.filter((player) => player.active).findIndex((player) => player.id === id),
        player_name: playerLabel(nextPlayers, nextPlayers.find((player) => player.id === id) || currentPlayer),
        players: rosterSnapshot(nextPlayers),
      });
    }
    if (typeof requestedPatch.active === "boolean") {
      captureMenuEvent("player_active_toggled", {
        active: requestedPatch.active,
        player_count: activePlayers.length,
        players: rosterSnapshot(nextPlayers),
      });
    }
    if (requestedPatch.color) {
      captureMenuEvent("player_color_changed", {
        color: requestedPatch.color,
        player_count: activePlayers.length,
        players: rosterSnapshot(nextPlayers),
      });
    }
    setMenu((current) => {
      let nextPatch = requestedPatch;
      if (requestedPatch.color && current.players.some((player) => player.id !== id && player.active && player.color.toLowerCase() === requestedPatch.color?.toLowerCase())) {
        return current;
      }
      if (requestedPatch.active === true) {
        const player = current.players.find((candidate) => candidate.id === id);
        if (player && current.players.some((candidate) => candidate.id !== id && candidate.active && candidate.color.toLowerCase() === player.color.toLowerCase())) {
          nextPatch = { ...requestedPatch, color: firstAvailableColor(current.players, id) };
        }
      }
      return {
        ...current,
        players: current.players.map((player) => (player.id === id ? { ...player, ...nextPatch } : player)),
      };
    });
  }

  function deletePlayer(id: number) {
    setError("");
    const nextPlayers = menu.players.filter((player) => player.id !== id);
    captureMenuEvent("player_removed", {
      player_count: menu.players.filter((player) => player.active).length,
      players: rosterSnapshot(nextPlayers),
    });
    setMenu((current) => ({ ...current, players: current.players.filter((player) => player.id !== id) }));
    setConfirmRemove(null);
  }

  async function beginSession(remoteRequest?: RemoteSessionRequest) {
    if (sessionStartInFlightRef.current) return;
    sessionStartInFlightRef.current = true;
    setSessionStarting(true);
    const defaultGame = menuGames[0] || games[0];
    const defaultSelectedLevels = defaultGame.levels?.length ? { [defaultGame.id]: defaultLevelID(defaultGame) } : {};
    const nextTeamName = remoteRequest?.teamName || defaultTeamName();
    const nextSessionID = remoteRequest?.venueSessionId || newVenueSessionID();
    const nextRecordingPolicy = menu.recordingPolicy;
    const nextRecordingEnabled = nextRecordingPolicy !== "off";
    const nowUnix = Math.floor(Date.now() / 1000);
    const nextPlayers = remoteRequest ? playersForCount(remoteRequest.configuredPlayerCount) : defaultPlayers;
    setMessage("Preparando sesión");
    setError("");
    try {
      const nextStatus = await postVenueSession({
        action: "start",
        venueSessionId: nextSessionID,
        teamName: nextTeamName,
        recordingEnabled: nextRecordingEnabled,
        recordingPolicy: { scope: nextRecordingPolicy },
        kioskId: menuKioskID(),
      });
      if (nextStatus) acceptStatus(nextStatus);
    } catch (err) {
      setMessage("");
      setError(friendlyRequestError(err, "No se pudo iniciar la sesión. Inténtalo de nuevo."));
      sessionStartInFlightRef.current = false;
      setSessionStarting(false);
      return;
    }
    captureMenuEvent("session_started", {
      default_team_name: !remoteRequest,
      remote_reservation: Boolean(remoteRequest),
      reservation_id: remoteRequest?.reservationId,
      reserved_player_count: remoteRequest?.playerCount,
      recording_enabled: nextRecordingEnabled,
      recording_scope: nextRecordingPolicy,
      venue_session_id: nextSessionID,
    });
    setMenu((current) => ({
      ...current,
      sessionActive: true,
      sessionId: nextSessionID,
      sessionStartedUnix: nowUnix,
      recordingEnabled: nextRecordingEnabled,
      recordingPolicy: nextRecordingPolicy,
      teamName: nextTeamName,
      players: nextPlayers,
      category: menuCategoryForGame(defaultGame, "featured"),
      selectedGame: defaultGame.id,
      difficulty: "easy",
      selectedLevels: defaultSelectedLevels,
      levelModes: current.levelModes,
      levelProgress: {},
      challengeRuns: {},
      freeRuns: {},
      nextPlayerId: Math.max(0, ...nextPlayers.map((player) => player.id)),
      narrationArmed: {},
      processedAttemptIDs: [],
    }));
    if (remoteRequest) {
      setRemoteSessionRequest(null);
      clearRemoteSessionURL();
    }
    setMessage("");
    setError("");
    setScreenMode("browse");
    setLevelBrowserGameID(null);
    setTeamOpen(true);
    setKeyboardTarget(null);
    setColorPickerFor(null);
    setConfirmRemove(null);
    setConfirmResetSession(false);
    setPendingLevelSwitch(null);
    setPartyRun(null);
    sessionStartInFlightRef.current = false;
    setSessionStarting(false);
  }

  async function closeSession(reason = "manual") {
    if (sessionCloseInFlightRef.current) return;
    sessionCloseInFlightRef.current = true;
    setConfirmResetSession(false);
    setError("");
    if (status?.currentGame && !animationIsIdleLoop(status.currentGame, status.phase)) {
      setMessage("Cerrando sesión");
      try {
        acceptStatus(await controlGame("exit"));
      } catch (err) {
        setMessage("");
        setError(friendlyRequestError(err, "No se pudo detener el juego. La sesión sigue abierta para que puedas reintentarlo."));
        sessionCloseInFlightRef.current = false;
        return;
      }
    }
    const defaultGame = menuGames[0] || games[0];
    if (menu.sessionId) {
      try {
        const endedStatus = await postVenueSession({
          action: "end",
          venueSessionId: menu.sessionId,
          reason,
          kioskId: menuKioskID(),
        });
        if (endedStatus) acceptStatus(endedStatus);
      } catch (err) {
        setMessage("");
        setError(friendlyRequestError(err, "No se pudo cerrar la sesión. Inténtalo de nuevo."));
        sessionCloseInFlightRef.current = false;
        return;
      }
    }
    captureMenuEvent("session_closed", {
      category: menu.category,
      reason,
      venue_session_id: menu.sessionId,
      player_count: activePlayers.length,
      selected_game: selectedGame.id,
    });
    setMenu((current) => clearedMenuSession(current, defaultGame));
    setKeyboardTarget(null);
    setColorPickerFor(null);
    setConfirmRemove(null);
    setConfirmResetSession(false);
    setPendingLevelSwitch(null);
    setPartyRun(null);
    setTeamOpen(false);
    setLevelBrowserGameID(null);
    setScreenMode("browse");
    setMessage("");
    setError("");
    sessionCloseInFlightRef.current = false;
  }

  function confirmRemoteSessionStart() {
    if (!remoteSessionRequest) return;
    void beginSession(remoteSessionRequest);
  }

  function dismissRemoteSessionStart() {
    setRemoteSessionRequest(null);
    clearRemoteSessionURL();
  }

  async function setSessionRecordingScope(scope: RecordingScope) {
    const recordingHealthy = status?.venueSessionRecordingAvailable !== false;
    if (recordingScopeChangeInFlightRef.current || (scope === menu.recordingPolicy && recordingHealthy)) return;
    if (scope !== "off" && !venueSessionRecordingCanRequest(status ?? {})) {
      setError("La grabación no está disponible en este sistema.");
      return;
    }
    recordingScopeChangeInFlightRef.current = true;
    setRecordingScopeSaving(true);
    setError("");
    const venueSessionId = menu.sessionId;
    const previousScope = status?.venueSessionId === venueSessionId
      ? venueSessionRecordingScope(status, menu.recordingPolicy)
      : menu.recordingPolicy;
    const enabled = scope !== "off";
    try {
      const result = await commitVenueSessionRecordingScope(
        previousScope,
        scope,
        async () => venueSessionId
          ? postVenueSession({
              action: "start",
              venueSessionId,
              teamName: menu.teamName,
              recordingEnabled: enabled,
              recordingPolicy: { scope },
              kioskId: menuKioskID(),
            })
          : null,
        (err) => friendlyRequestError(err, "No se pudo cambiar el alcance de grabación. Se ha restaurado la configuración anterior."),
      );
      if (result.status) acceptStatus(result.status);
      setMenu((current) => current.sessionId !== venueSessionId
        ? current
        : {
            ...current,
            recordingEnabled: result.scope !== "off",
            recordingPolicy: result.scope,
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      captureMenuEvent("session_recording_policy_changed", {
        recording_configured: result.status?.venueSessionRecordingConfigured,
        recording_available: result.status?.venueSessionRecordingAvailable,
        recording_enabled: result.scope !== "off" && result.status?.venueSessionRecordingAvailable !== false,
        recording_scope: result.scope,
        requested_recording_scope: scope,
        venue_session_id: venueSessionId,
      });
      if (result.status?.venueSessionRecordingAvailable === false && result.scope !== "off") {
        setError("El servicio de grabación está degradado. Se reintentará con el alcance guardado.");
      } else if (result.scope !== scope) {
        setError("El motor no confirmó el nuevo alcance. Se ha restaurado su configuración autoritativa.");
      }
    } finally {
      recordingScopeChangeInFlightRef.current = false;
      setRecordingScopeSaving(false);
    }
  }

  function openSettings() {
    captureMenuEvent("settings_opened", {
      operator_unlock_levels: menu.operatorUnlockLevels,
    });
    setSettingsOpen(true);
    setSettingsUnlocked(false);
    setSettingsPin("");
    setSettingsError(Date.now() < settingsLockoutUntil ? "Demasiados intentos. Espera unos segundos." : "");
  }

  function closeSettings() {
    setSettingsOpen(false);
    setSettingsUnlocked(false);
    setSettingsPin("");
    setSettingsError("");
  }

  function setOperatorUnlockLevels(enabled: boolean) {
    captureMenuEvent("operator_unlock_levels_changed", {
      enabled,
      env_unlock_levels: envUnlockLevels,
    });
    setMenu((current) => ({ ...current, operatorUnlockLevels: enabled }));
  }

  function submitSettingsPin(pin = settingsPin) {
    if (Date.now() < settingsLockoutUntil) return;
    if (pin === operatorSettingsPin) {
      setSettingsUnlocked(true);
      setSettingsPin("");
      setSettingsError("");
      setSettingsPinFailures(0);
      setSettingsLockoutUntil(0);
      captureMenuEvent("settings_unlocked");
      return;
    }
    const nextFailures = settingsPinFailures + 1;
    setSettingsPin("");
    setSettingsPinFailures(nextFailures);
    if (nextFailures >= 3) {
      const lockoutUntil = Date.now() + 15000;
      setSettingsLockoutUntil(lockoutUntil);
      setSettingsError("Demasiados intentos. Espera 15 segundos.");
      window.setTimeout(() => {
        setSettingsPinFailures(0);
        setSettingsLockoutUntil(0);
        setSettingsError("");
      }, 15000);
    } else {
      setSettingsError(`Código incorrecto · intento ${nextFailures}/3`);
    }
    captureMenuEvent("settings_pin_failed", {
      failures: nextFailures,
    });
  }

  function typeSettingsPinDigit(digit: string) {
    if (Date.now() < settingsLockoutUntil) return;
    setSettingsError("");
    setSettingsPin((current) => {
      const next = `${current}${digit}`.slice(0, 6);
      if (next.length === 6) window.setTimeout(() => submitSettingsPin(next), 0);
      return next;
    });
  }

  function keyboardValue() {
    if (!keyboardTarget) return "";
    if (keyboardTarget.kind === "team") return menu.teamName;
    return menu.players.find((player) => player.id === keyboardTarget.id)?.name || "";
  }

  function keyboardTitle() {
    if (!keyboardTarget) return "";
    if (keyboardTarget.kind === "team") return "Nombre del equipo";
    const player = menu.players.find((candidate) => candidate.id === keyboardTarget.id);
    return player ? `Jugador ${menu.players.indexOf(player) + 1}` : "Jugador";
  }

  function keyboardMaxLength() {
    return keyboardTarget?.kind === "team" ? maxTeamNameLength : maxPlayerNameLength;
  }

  function keyboardTargetsMatch(left: KeyboardTarget | null, right: KeyboardTarget | null) {
    if (!left || !right) return false;
    if (left.kind === "team") return right.kind === "team";
    return right.kind === "player" && left.id === right.id;
  }

  function nameValue(target: KeyboardTarget, state: MenuState = menuRef.current) {
    if (target.kind === "team") return state.teamName;
    return state.players.find((player) => player.id === target.id)?.name || "";
  }

  function beginNameEdit(target: KeyboardTarget) {
    if (keyboardTargetsMatch(nameEditStartRef.current?.target || null, target)) return;
    nameEditStartRef.current = { target, value: nameValue(target) };
  }

  function openTouchKeyboard(target: KeyboardTarget) {
    beginNameEdit(target);
    touchKeyboardTargetRef.current = target;
    setKeyboardTarget(target);
  }

  function setNameDraft(target: KeyboardTarget, value: string) {
    const maxLength = target.kind === "team" ? maxTeamNameLength : maxPlayerNameLength;
    const next = cleanNameDraft(value, maxLength);
    setMenu((current) => target.kind === "team"
      ? { ...current, teamName: next }
      : {
          ...current,
          players: current.players.map((player) => player.id === target.id ? { ...player, name: next } : player),
        });
  }

  function finishNameEdit(target: KeyboardTarget, closeKeyboard = false) {
    const maxLength = target.kind === "team" ? maxTeamNameLength : maxPlayerNameLength;
    const next = cleanNameWhitespace(nameValue(target), maxLength);
    const initial = keyboardTargetsMatch(nameEditStartRef.current?.target || null, target)
      ? cleanNameWhitespace(nameEditStartRef.current?.value || "", maxLength)
      : next;

    if (target.kind === "team") {
      if (next !== initial) captureMenuEvent("team_renamed", { team_name: next });
      setMenu((current) => current.teamName === next ? current : { ...current, teamName: next });
    } else {
      const currentMenu = menuRef.current;
      const currentPlayer = currentMenu.players.find((player) => player.id === target.id);
      if (currentPlayer && next !== initial) {
        const nextPlayers = currentMenu.players.map((player) => player.id === target.id ? { ...player, name: next } : player);
        captureMenuEvent("player_renamed", {
          player_index: currentMenu.players.filter((player) => player.active).findIndex((player) => player.id === target.id),
          player_name: playerLabel(nextPlayers, nextPlayers.find((player) => player.id === target.id) || currentPlayer),
          players: rosterSnapshot(nextPlayers),
        });
      }
      setMenu((current) => ({
        ...current,
        players: current.players.map((player) => player.id === target.id && player.name !== next ? { ...player, name: next } : player),
      }));
    }

    nameEditStartRef.current = null;
    if (closeKeyboard) {
      touchKeyboardTargetRef.current = null;
      setKeyboardTarget(null);
      window.requestAnimationFrame(() => teamCloseRef.current?.focus({ preventScroll: true }));
    }
  }

  function setKeyboardValue(value: string) {
    if (keyboardTarget) setNameDraft(keyboardTarget, value.slice(0, keyboardMaxLength()));
  }

  function regenerateTeamName() {
    const next = defaultTeamName();
    captureMenuEvent("team_renamed", { generated: true, team_name: next });
    setMenu((current) => ({ ...current, teamName: next }));
    nameEditStartRef.current = null;
  }

  function typeKey(key: string) {
    const current = keyboardValue();
    setKeyboardValue(`${current}${key}`);
  }

  function selectGameCard(gameID: string) {
    const game = menuGames.find((candidate) => candidate.id === gameID);
    if (game) {
      captureMenuEvent("game_selected", {
        category: game.category,
        engine_game: engineGameID(game),
        game: game.id,
        has_levels: Boolean(game.levels?.length),
        player_count: activePlayers.length,
      });
    }
    setMenu((current) => {
      const difficulty = game ? normalizedDifficultyForGame(game, current.difficulty) : current.difficulty;
      const levelID = game?.levels?.length
        ? closestLevelIDForDifficulty(game, current.selectedLevels[gameID] || defaultLevelIDForDifficulty(game, difficulty), difficulty)
        : "";
      const selectedLevels = game?.levels?.length && current.selectedLevels[gameID] !== levelID ? { ...current.selectedLevels, [gameID]: levelID } : current.selectedLevels;
      return {
        ...current,
        difficulty,
        selectedGame: gameID,
        selectedLevels,
      };
    });
    setLevelBrowserGameID(game?.levels?.length ? game.id : null);
    setError("");
    setMessage("");
    if (game && isAmbientCard(game) && !game.disabled && isGameLaunchable(game)) {
      void launch(game.id);
    }
  }

  function selectedLevelFor(game: GameCard, state = menu): string {
    if (!game.levels?.length) return "";
    const difficulty = activeDifficultyForGame(game, state);
    const selected = closestLevelIDForDifficulty(game, state.selectedLevels[game.id] || defaultLevelIDForDifficulty(game, difficulty), difficulty);
    if (isLevelUnlocked(game, selected, state)) return selected;
    return challengeNextLevel(game, state)?.id || defaultLevelIDForDifficulty(game, difficulty);
  }

  function setLevelMode(game: GameCard, mode: LevelMode) {
    if (!game.levels?.length) return;
    if (levelModeFor(game, menu) === mode) return;
    captureMenuEvent("level_mode_changed", {
      engine_game: engineGameID(game),
      game: game.id,
      mode,
    });
    setMenu((current) => {
      const nextLevelModes = {
        ...current.levelModes,
        [game.id]: mode,
      };
      const nextChallengeRuns = { ...current.challengeRuns };
      delete nextChallengeRuns[game.id];
      const nextFreeRuns = { ...current.freeRuns };
      delete nextFreeRuns[game.id];
      const difficulty = activeDifficultyForGame(game, current);
      const selected = mode === "challenge"
        ? defaultLevelIDForDifficulty(game, difficulty)
        : closestLevelIDForDifficulty(game, selectedLevelFor(game, current), difficulty);
      return {
        ...current,
        levelModes: nextLevelModes,
        challengeRuns: nextChallengeRuns,
        freeRuns: nextFreeRuns,
        selectedLevels: {
          ...current.selectedLevels,
          [game.id]: selected,
        },
      };
    });
  }

  function setSelectedLevel(game: GameCard, levelID: string) {
    const difficulty = activeDifficultyForGame(game, menu);
    const level = logicalLevelForGame(game, levelID);
    if (!levelSupportsDifficulty(game, level, difficulty) || !isLevelUnlocked(game, levelID, menu)) {
      captureMenuEvent("locked_level_tapped", {
        engine_game: engineGameID(game),
        game: game.id,
        level: levelID,
        level_number: levelNumberForGame(game, levelID),
      });
      return;
    }
    captureMenuEvent("level_selected", {
      difficulty,
      engine_game: engineGameID(game),
      game: game.id,
      level: levelID,
      level_number: levelNumberForGame(game, levelID),
    });
    setMenu((current) => ({
      ...current,
      difficulty: normalizedDifficultyForGame(game, current.difficulty),
      selectedLevels: {
        ...current.selectedLevels,
        [game.id]: levelID,
      },
    }));
  }

  function renderLevelOption(game: GameCard, level: NonNullable<GameCard["levels"]>[number]) {
    const active = selectedLevelFor(game) === level.id;
    const levelIndex = logicalLevelIndexForGame(game, level.id);
    const levelLabel = playerLevelLabel(level, levelIndex);
    const progress = progressFor(game, menu);
    const challengeMode = levelModeFor(game, menu) === "challenge";
    const challengeRun = challengeRunFor(game, menu);
    const challengeCompleted = challengeMode && challengeRun?.completedLevels[level.id] !== undefined;
    const challengeCurrent = challengeMode && challengeNextLevel(game, menu)?.id === level.id;
    const bestDifficulty = challengeMode ? undefined : progress.bestByLevel[level.id];
    const locked = !isLevelUnlocked(game, level.id, menu);
    const previewDifficulty = closestSupportedDifficulty(activeDifficultyForGame(game, menu), supportedDifficultiesFor(game, level));
    const revealPreview = challengeLevelPreviewRevealed(game, level.id, menu, active);
    return (
      <button
        key={level.id}
        className={`level-option ${active ? "active" : ""} ${locked ? "locked" : ""} ${bestDifficulty || challengeCompleted ? "passed" : ""}`}
        style={{ "--level-color": difficultyColor(bestDifficulty), "--level-rgb": hexToRGB(difficultyColor(bestDifficulty)), "--c": game.color, "--crgb": hexToRGB(game.color) } as CSSProperties}
        type="button"
        role="radio"
        disabled={locked}
        aria-checked={active}
        aria-disabled={locked}
        aria-label={`${levelLabel}${locked ? ", bloqueado en modo reto" : ""}`}
        onClick={() => setSelectedLevel(game, level.id)}
      >
        {revealPreview ? (
          <Preview
            src={levelThumbnailSrc(level, game)}
            srcs={levelThumbnailSrcs(level, game)}
            richSrc={active ? levelPreviewSrc(game, level, previewDifficulty) : undefined}
            richSrcs={active ? levelPreviewSrcs(game, level, previewDifficulty) : emptyPreviewSources}
            animationID={levelFallbackPreviewAnimationID(game, level)}
            revisionHash={level.previewRevisionHash || game.previewRevisionHash}
            compact
            promoteAnimation={active && !levelHasPreviewMedia(level)}
          />
        ) : (
          <LevelMysteryPreview />
        )}
        <span className="level-footer">
          <strong>{levelLabel}</strong>
          {locked ? (
            <span className="level-state locked-label">{levelModeFor(game, menu) === "challenge" ? "Reto" : "Bloqueado"}</span>
          ) : challengeCompleted ? (
            <span className="level-state challenge-state challenge-done">Hecho</span>
          ) : challengeCurrent ? (
            <span className="level-state challenge-state">Actual</span>
          ) : challengeMode ? (
            <span className="level-state challenge-state challenge-pending">Pendiente</span>
          ) : (
            <span className={`level-state ${bestDifficulty ? "rated" : "unrated"}`}>
              <StarRating difficulty={bestDifficulty} label="Mejor dificultad" muted={!bestDifficulty} />
            </span>
          )}
        </span>
      </button>
    );
  }

  function renderActiveLevelOption(game: GameCard, level: NonNullable<GameCard["levels"]>[number], options: {
    activeLevelID: string;
    launchingLevelID: string | null;
    launchPhase: ActiveLevelLaunchPhase | null;
    levelMode: LevelMode;
    selectable: boolean;
    onSelect: (levelID: string) => void;
  }) {
    const launching = options.launchingLevelID === level.id;
    const active = options.launchingLevelID ? launching : options.activeLevelID === level.id;
    const levelIndex = logicalLevelIndexForGame(game, level.id);
    const levelLabel = playerLevelLabel(level, levelIndex);
    const progress = progressFor(game, menu);
    const challengeMode = options.levelMode === "challenge";
    const challengeRun = challengeRunFor(game, menu);
    const challengeCompleted = challengeMode && challengeRun?.completedLevels[level.id] !== undefined;
    const challengeCurrent = challengeMode && challengeNextLevel(game, menu)?.id === level.id;
    const bestDifficulty = challengeMode ? undefined : progress.bestByLevel[level.id];
    const previewDifficulty = closestSupportedDifficulty(activeDifficultyForGame(game, menu), supportedDifficultiesFor(game, level));
    const selectable = options.selectable && !options.launchingLevelID;
    const revealPreview = challengeLevelPreviewRevealed(game, level.id, menu, active, options.levelMode);
    return (
      <button
        key={level.id}
        className={`level-option active-game-level ${active ? "active" : ""} ${launching ? "loading" : ""} ${bestDifficulty || challengeCompleted ? "passed" : ""} ${selectable ? "" : "readonly"}`}
        style={{ "--level-color": difficultyColor(bestDifficulty), "--level-rgb": hexToRGB(difficultyColor(bestDifficulty)), "--c": game.color, "--crgb": hexToRGB(game.color) } as CSSProperties}
        type="button"
        role="radio"
        aria-busy={launching || undefined}
        aria-checked={active || launching}
        aria-label={`${levelLabel}${launching ? ", cargando" : selectable ? "" : options.levelMode === "challenge" ? ", solo lectura durante reto" : ""}`}
        disabled={!selectable}
        onClick={() => options.onSelect(level.id)}
      >
        {revealPreview ? (
          <Preview
            src={levelThumbnailSrc(level, game)}
            srcs={levelThumbnailSrcs(level, game)}
            richSrc={active ? levelPreviewSrc(game, level, previewDifficulty) : undefined}
            richSrcs={active ? levelPreviewSrcs(game, level, previewDifficulty) : emptyPreviewSources}
            animationID={levelFallbackPreviewAnimationID(game, level)}
            revisionHash={level.previewRevisionHash || game.previewRevisionHash}
            compact
            promoteAnimation={active && !levelHasPreviewMedia(level)}
          />
        ) : (
          <LevelMysteryPreview />
        )}
        <span className="level-footer">
          <strong>{levelLabel}</strong>
          {launching ? (
            <span className="level-state loading-label">
              <span className="launch-spinner" aria-hidden="true" />
              {options.launchPhase === "stopping" ? "Deteniendo" : "Cargando"}
            </span>
          ) : active ? (
            <span className="level-state rated">Actual</span>
          ) : challengeCompleted ? (
            <span className="level-state challenge-state challenge-done">Hecho</span>
          ) : challengeCurrent ? (
            <span className="level-state challenge-state">Actual</span>
          ) : challengeMode ? (
            <span className="level-state challenge-state challenge-pending">Pendiente</span>
          ) : (
            <span className={`level-state ${bestDifficulty ? "rated" : "unrated"}`}>
              <StarRating difficulty={bestDifficulty} label="Mejor dificultad" muted={!bestDifficulty} />
            </span>
          )}
        </span>
      </button>
    );
  }

  function renderPartyPreview(game: GameCard, options: { compact?: boolean; rich?: boolean } = {}) {
    const rich = options.rich ?? !options.compact;
    if (!isPartyCard(game) || !game.partyMiniGames?.length) {
      return (
        <Preview
          src={gameThumbnailSrc(game)}
          srcs={gameThumbnailSrcs(game)}
          richSrc={rich ? game.previewSrc : undefined}
          richSrcs={rich ? gamePreviewSrcs(game) : emptyPreviewSources}
          animationID={previewAnimationID(game)}
          revisionHash={game.previewRevisionHash}
          compact={options.compact}
          promoteAnimation={rich}
        />
      );
    }
    return (
      <PartyPreview
        game={game}
        catalogGames={menuGames}
        difficulty={menu.difficulty}
        compact={options.compact}
        rich={rich}
      />
    );
  }

  function narrationArmedFor(game: GameCard, state = menu): boolean {
    if (!supportsNarration(game)) return false;
    return state.narrationArmed[game.id] ?? true;
  }

  function setNarrationArmed(game: GameCard, armed: boolean) {
    captureMenuEvent("narration_toggled", {
      engine_game: engineGameID(game),
      game: game.id,
      narration_enabled: armed,
    });
    setMenu((current) => ({
      ...current,
      narrationArmed: {
        ...current.narrationArmed,
        [game.id]: armed,
      },
    }));
    setMessage((current) => (current.startsWith("Narración") ? "" : current));
  }

  function setGameConfigValue(game: GameCard, key: string, value: number | boolean | string | undefined) {
    setMenu((current) => {
      const existing = { ...(current.gameConfig[game.id] || {}) };
      if (value === undefined) {
        delete existing[key];
      } else {
        existing[key] = value;
      }
      const gameConfig = { ...current.gameConfig };
      if (Object.keys(existing).length) {
        gameConfig[game.id] = existing;
      } else {
        delete gameConfig[game.id];
      }
      return { ...current, gameConfig };
    });
  }

  function resetGameConfig(game: GameCard) {
    captureMenuEvent("game_config_reset", {
      engine_game: engineGameID(game),
      game: game.id,
    });
    setMenu((current) => {
      if (!current.gameConfig[game.id]) return current;
      const gameConfig = { ...current.gameConfig };
      delete gameConfig[game.id];
      return { ...current, gameConfig };
    });
  }

  async function launch(gameID = selectedGame.id, options: { difficulty?: DifficultyID; levelID?: string; levelMode?: LevelMode; partyIndex?: number; partyScore?: number; resetChallengeRun?: boolean } = {}): Promise<boolean> {
    if (launchInFlightRef.current) return false;
    const game = menuGames.find((candidate) => candidate.id === gameID);
    if (!game || game.disabled || !isGameLaunchable(game)) {
      captureMenuEvent("start_blocked", {
        engine_game: game ? engineGameID(game) : gameID,
        game: game?.id || gameID,
        reason: !game ? "missing" : game.disabled ? "disabled" : "engine_unavailable",
      });
      return false;
    }
    let nextMenu = { ...menu, selectedGame: game.id };
    const partyIndex = isPartyCard(game) ? Math.max(0, Math.min((game.partyMiniGames?.length || 1) - 1, options.partyIndex || 0)) : 0;
    const launchGame = partyLaunchGame(game, menuGames, partyIndex);
    if (!launchGame) {
      captureMenuEvent("start_blocked", {
        engine_game: engineGameID(game),
        game: game.id,
        reason: "party_game_unavailable",
      });
      setPartyRun(null);
      setMessage("");
      setError("Este juego del Party ya no está disponible");
      return false;
    }
    if (!launchGame.allowAnyPlayers) nextMenu = ensurePlayers(nextMenu);
    const partyFirstMiniGame = isPartyCard(game) ? game.partyMiniGames?.[partyIndex] : undefined;
    const levelOverride = options.levelID && launchGame.levels?.some((level) => level.id === options.levelID) ? options.levelID : undefined;
    if (levelOverride) {
      nextMenu = {
        ...nextMenu,
        selectedLevels: {
          ...nextMenu.selectedLevels,
          [launchGame.id]: levelOverride,
        },
      };
    }
    if (options.difficulty) {
      nextMenu = { ...nextMenu, difficulty: options.difficulty };
    }
    if (options.levelMode && launchGame.levels?.length) {
      const nextLevelModes = {
        ...nextMenu.levelModes,
        [launchGame.id]: options.levelMode,
      };
      const nextChallengeRuns = { ...nextMenu.challengeRuns };
      if (options.levelMode === "free") delete nextChallengeRuns[launchGame.id];
      nextMenu = {
        ...nextMenu,
        levelModes: nextLevelModes,
        challengeRuns: nextChallengeRuns,
      };
    }
    if (options.resetChallengeRun && launchGame.levels?.length && levelModeFor(launchGame, nextMenu) === "challenge") {
      const { [launchGame.id]: _discardedRun, ...challengeRuns } = nextMenu.challengeRuns;
      const resetDifficulty = usesDifficulty(launchGame) ? normalizedDifficultyForGame(launchGame, nextMenu.difficulty) : nextMenu.difficulty;
      nextMenu = {
        ...nextMenu,
        challengeRuns,
        selectedLevels: {
          ...nextMenu.selectedLevels,
          [launchGame.id]: defaultLevelIDForDifficulty(launchGame, resetDifficulty),
        },
      };
    }
    if (!nextMenu.sessionId) {
      nextMenu = {
        ...nextMenu,
        sessionActive: true,
        sessionId: newVenueSessionID(),
        sessionStartedUnix: nextMenu.sessionStartedUnix || Math.floor(Date.now() / 1000),
      };
    }
    const nextRosterIssue = gameRosterIssue(game, nextMenu.players);
    if (!isAmbientCard(game) && nextRosterIssue) {
      captureMenuEvent("start_blocked", {
        engine_game: engineGameID(game),
        game: game.id,
        player_count: nextMenu.players.filter((player) => player.active).length,
        reason: "roster_issue",
      });
      setMenu(nextMenu);
      setMessage("");
      setError(nextRosterIssue.message);
      setTeamOpen(true);
      return false;
    }
    const playNarration = narrationArmedFor(game, nextMenu);
    const showCountdownOverlay = launchGame.countdownFloorOverlay === true;
    const launchRoster = rosterForGame(launchGame, nextMenu.players);
    const partyParentDifficulty = isPartyCard(game) && usesDifficulty(game)
      ? normalizedDifficultyForGame(game, nextMenu.difficulty)
      : undefined;
    const partyChildDifficulty = partyFirstMiniGame?.difficultyMode === "override" && partyFirstMiniGame.difficulty
      ? partyFirstMiniGame.difficulty
      : partyParentDifficulty;
    const requestedDifficulty = partyChildDifficulty || nextMenu.difficulty;
    const launchDifficulty = usesDifficulty(launchGame) ? normalizedDifficultyForGame(launchGame, requestedDifficulty) : undefined;
    const requestedLevelID = partyFirstMiniGame?.level || levelOverride || selectedLevelFor(launchGame, nextMenu);
    const selectedLevelID = launchGame.levels?.length && launchDifficulty
      ? closestLevelIDForDifficulty(launchGame, requestedLevelID, launchDifficulty)
      : requestedLevelID;
    const launchLevel = logicalLevelForGame(launchGame, selectedLevelID);
    const menuDifficulty = isPartyCard(game) ? partyParentDifficulty : launchDifficulty;
    if (menuDifficulty && nextMenu.difficulty !== menuDifficulty) {
      nextMenu = { ...nextMenu, difficulty: menuDifficulty };
    }
    if (launchGame.levels?.length && selectedLevelID && nextMenu.selectedLevels[launchGame.id] !== selectedLevelID) {
      nextMenu = {
        ...nextMenu,
        selectedLevels: {
          ...nextMenu.selectedLevels,
          [launchGame.id]: selectedLevelID,
        },
      };
    }
    const challengeDifficulty = (launchDifficulty || nextMenu.difficulty) as DifficultyID;
    const launchLevelMode = launchGame.levels?.length ? levelModeFor(launchGame, nextMenu) : undefined;
    const startsChallengeRun = Boolean(
      launchGame.levels?.length
      && selectedLevelID
      && launchLevelMode === "challenge"
      && !challengeRunFor(launchGame, nextMenu)
    );
    if (startsChallengeRun) {
      nextMenu = {
        ...nextMenu,
        challengeRuns: {
          ...nextMenu.challengeRuns,
          [launchGame.id]: emptyChallengeRun(challengeDifficulty),
        },
      };
    }
    const launchChallengeRun = launchLevelMode === "challenge" ? challengeRunFor(launchGame, nextMenu) : null;
    const launchFreeRun = launchLevelMode === "free" ? freeRunFor(launchGame, nextMenu) || emptyFreeRun(nextMenu.sessionId) : null;
    const launchConfig = menuConfigOverridesFor(launchGame, nextMenu);
    const launchDifficultyLevels = launchGame.levels?.length && launchDifficulty ? levelsForDifficulty(launchGame, launchDifficulty) : [];
    if (selectedLevelID && !isLevelUnlocked(launchGame, selectedLevelID, nextMenu)) {
      captureMenuEvent("start_blocked", {
        engine_game: engineGameID(launchGame),
        game: game.id,
        level: selectedLevelID,
        level_number: levelNumberForGame(launchGame, selectedLevelID),
        reason: "level_locked",
      });
      setMenu(nextMenu);
      setMessage("");
      setError("Nivel bloqueado");
      return false;
    }
    launchInFlightRef.current = true;
    setMenu(nextMenu);
    setMessage(isPartyCard(game) && game.partyMiniGames?.length ? `Party ${partyIndex + 1}/${game.partyMiniGames.length}` : "Iniciando");
    setError("");
    setLaunchingGameID(game.id);
    setPartyRun(isPartyCard(game) ? {
      cumulativeScore: options.partyScore || 0,
      index: partyIndex,
      partyGameID: game.id,
      sessionId: nextMenu.sessionId,
    } : null);
    captureMenuEvent("game_launch_requested", {
      ambient: isAmbientCard(game),
      category: game.category,
      difficulty: launchDifficulty,
      difficulty_label: launchDifficulty ? difficulties.find((difficulty) => difficulty.id === launchDifficulty)?.label : undefined,
      engine_game: engineGameID(launchGame),
      launch_engine_game: engineGameID(launchGame),
      game: game.id,
      game_label: game.label,
      level: selectedLevelID || undefined,
      level_label: launchLevel?.label,
      level_number: selectedLevelID ? levelNumberForGame(launchGame, selectedLevelID) : undefined,
      level_mode: launchGame.levels?.length ? levelModeFor(launchGame, nextMenu) : undefined,
      narration_enabled: supportsNarration(game) ? playNarration : false,
      countdown_floor_overlay: showCountdownOverlay,
      player_count: launchRoster.length,
      recording_enabled: nextMenu.recordingEnabled,
      recording_scope: nextMenu.recordingPolicy,
      venue_session_id: nextMenu.sessionId,
      ...(launchConfig ? { config_overrides: launchConfig } : {}),
    });
    if (startsChallengeRun) {
      captureMenuEvent("challenge_started", {
        difficulty: challengeDifficulty,
        engine_game: engineGameID(launchGame),
        game: launchGame.id,
        game_label: launchGame.label,
        game_revision: launchGame.revisionHash || null,
        level_count: launchDifficultyLevels.length || launchGame.levels?.length || 0,
        revision_hash: launchGame.revisionHash || null,
        venue_session_id: nextMenu.sessionId,
      });
    }
    try {
      const launchRequest: SelectGameRequest = {
        game: runtimeGameID(launchGame),
        engineGame: engineGameID(launchGame),
        gameLabel: launchGame.label,
        sourceKind: launchGame.sourceKind,
        sourceRevision: launchGame.sourceRevision,
        platformUrl: platformBaseURL() || undefined,
        venueSessionId: nextMenu.sessionId,
        recordingEnabled: nextMenu.recordingEnabled,
        recordingPolicy: { scope: nextMenu.recordingPolicy },
        playerCount: launchGame.allowAnyPlayers ? 0 : Math.max(1, launchRoster.length),
        allowAnyPlayers: launchGame.allowAnyPlayers === true,
        difficulty: launchDifficulty,
        level: selectedLevelID || undefined,
        levelSlug: launchLevel?.slug || undefined,
        levelMode: launchLevelMode,
        durationSeconds: launchGame.levels?.length ? undefined : launchGame.estimatedDurationSeconds || undefined,
        challengeElapsedMillis: launchChallengeRun?.totalElapsedMillis || launchFreeRun?.totalElapsedMillis || 0,
        challengeAttemptCount: launchChallengeRun?.attemptCount || 0,
        narrationEnabled: supportsNarration(launchGame) ? playNarration : false,
        countdownFloorOverlay: showCountdownOverlay,
        teamName: nextMenu.teamName.trim(),
        config: launchConfig,
        players: launchRoster.map((player, index) => ({
          index,
          label: playerLabel(nextMenu.players, player),
          color: hexToColor(player.color),
        })),
      };
      if (launchLocalPlayground(launchRequest)) return true;
      const nextStatus = await selectGame(launchRequest);
      acceptStatus(nextStatus);
      const gateProjection = recordingGateMenuProjection(nextStatus.recordingGate, nextStatus.allowedControls);
      setMessage(isPartyCard(game) && game.partyMiniGames?.length
        ? `Party ${partyIndex + 1}/${game.partyMiniGames.length} · ${options.partyScore || 0} pts`
        : gateProjection?.title || "En curso");
      if (supportsNarration(launchGame) && playNarration) {
        setMenu((current) => ({
          ...current,
          narrationArmed: {
            ...current.narrationArmed,
            [game.id]: false,
          },
        }));
      }
      setTeamOpen(false);
      setKeyboardTarget(null);
      setScreenMode(isAmbientCard(game) ? "browse" : "game");
      return true;
    } catch (err) {
      captureMenuEvent("start_failed", {
        engine_game: engineGameID(launchGame),
        error: err instanceof Error ? err.message : "unknown",
        game: game.id,
      });
      setMessage("");
      setError(friendlyRequestError(err, "No se pudo iniciar el juego. Inténtalo de nuevo."));
      return false;
    } finally {
      launchInFlightRef.current = false;
      setLaunchingGameID((current) => (current === game.id ? null : current));
    }
  }

  async function restartLaunchedGame() {
    captureMenuEvent("game_restarted", {
      engine_game: engineGameID(launchedGame),
      game: launchedGame.id,
      level: status?.level || selectedLevelFor(launchedGame) || undefined,
    });
    if (launchedGame.levels?.length && levelModeFor(launchedGame, menu) === "challenge") {
      setMenu((current) => {
        const { [launchedGame.id]: _discardedRun, ...challengeRuns } = current.challengeRuns;
        return { ...current, challengeRuns };
      });
    }
    // Restart the current runtime selection instead of selecting the game
    // again. This keeps "Cada juego" as one video while "Cada intento" gets
    // a fresh run/capture boundary from the runtime.
    await sendGameControl("restart");
  }

  function requestActiveLevelSwitch(levelID: string) {
    if (!launchedGame.levels?.length) return;
    if (activeLevelLaunch?.gameID === launchedGame.id) return;
    const activeMode = activeLevelModeFor(launchedGame, menu, status);
    const activeLevelID = status?.level || selectedLevelFor(launchedGame);
    if (levelID === activeLevelID && isLevelRuntimeActive(status, launchedGame)) return;
    if (!isLevelUnlockedForMode(launchedGame, levelID, menu, activeMode)) {
      setSelectedLevel(launchedGame, levelID);
      return;
    }
    if (isLevelRuntimeActive(status, launchedGame)) {
      setPendingLevelSwitch({ gameID: launchedGame.id, levelID });
      return;
    }
    void switchLaunchedLevel(launchedGame, levelID, false, activeMode);
  }

  async function switchLaunchedLevel(game: GameCard, levelID: string, stopCurrent: boolean, mode = levelModeFor(game, menu)) {
    if (levelSwitchInFlightRef.current || controlInFlightRef.current || launchInFlightRef.current) return;
    const level = logicalLevelForGame(game, levelID);
    if (!level || !isLevelUnlockedForMode(game, levelID, menu, mode)) return;
    levelSwitchInFlightRef.current = true;
    if (stopCurrent) controlInFlightRef.current = true;
    const difficulty = activeDifficultyForGame(game, menu);
    setPendingLevelSwitch(null);
    setActiveLevelLaunch({ gameID: game.id, levelID, phase: stopCurrent ? "stopping" : "loading" });
    setError("");
    captureMenuEvent("level_selected", {
      difficulty,
      engine_game: engineGameID(game),
      game: game.id,
      level: levelID,
      level_number: levelNumberForGame(game, levelID),
      stopped_current: stopCurrent,
      source: "active_game",
    });
    try {
      if (stopCurrent) {
        setMessage("Deteniendo nivel");
        const stoppedStatus = await controlGame("exit");
        acceptStatus(stoppedStatus);
      }
      setActiveLevelLaunch({ gameID: game.id, levelID, phase: "loading" });
      setMessage("Cambiando nivel");
      await launch(game.id, { levelID, levelMode: mode });
    } catch (err) {
      setMessage("");
      setError(friendlyRequestError(err, "No se pudo cambiar de nivel. Inténtalo de nuevo."));
    } finally {
      levelSwitchInFlightRef.current = false;
      if (stopCurrent) controlInFlightRef.current = false;
      setActiveLevelLaunch((current) => (
        current?.gameID === game.id && current.levelID === levelID ? null : current
      ));
    }
  }

  async function sendGameControl(action: ControlGameAction, recordingGateId?: string) {
    if (controlInFlightRef.current) return;
    if (connectionState !== "connection-on") {
      setMessage("");
      setError("La sala está reconectando. Espera un momento e inténtalo de nuevo.");
      return;
    }
    if (isRecordingGateAction(action)) {
      const gate = status?.recordingGate;
      if (!gate || gate.state !== "timed_out" || gate.id !== recordingGateId || !status.allowedControls.includes(action)) {
        setMessage("");
        setError("La decisión de grabación ya no está disponible.");
        return;
      }
    }
    controlInFlightRef.current = true;
    setPendingControlAction(action);
    setError("");
    const activeMode = activeLevelModeFor(launchedGame, menu, status);
    const stopLevelOnly = action === "exit" && activeMode === "free" && isLevelRuntimeActive(status, launchedGame);
    captureMenuEvent("control_used", {
      action,
      engine_game: engineGameID(launchedGame),
      game: launchedGame.id,
      level: status?.level || undefined,
      phase: status?.phase,
      ...(recordingGateId ? { recording_gate_id: recordingGateId } : {}),
    });
    try {
      const nextStatus = await controlGame(action, recordingGateId ? { recordingGateId } : undefined);
      acceptStatus(nextStatus);
      if (action === "recording_retry") {
        setMessage(recordingGateMenuProjection(nextStatus.recordingGate, nextStatus.allowedControls)?.title || "Preparando GoPro");
      } else if (action === "recording_continue_without") {
        setMessage("Partida iniciada sin grabación");
      } else if (action === "recording_cancel") {
        setMessage("Inicio cancelado");
      } else if (action === "restart") {
        setMessage("Reiniciando");
      } else if (action === "exit") {
        if (stopLevelOnly) {
          setMessage("Nivel detenido");
          return;
        }
        const engineGame = gameForEngineStatus(nextStatus.currentGame, launchedGame.id, menuGames);
        if (launchedGame.levels?.length && engineGame?.id === launchedGame.id && !animationIsIdleLoop(nextStatus.currentGame, nextStatus.phase)) {
          setMessage("Nivel detenido");
        } else {
          setMessage("Juego finalizado");
        }
      } else if (action === "narration") {
        setMessage("Narración");
      } else if (action === "toggle_mute" || action === "mute" || action === "unmute") {
        setMessage(nextStatus.audioMuted ? "Audio silenciado" : "Audio activo");
      } else {
        setMessage(action === "pause" ? "Pausado" : "En curso");
      }
    } catch (err) {
      setMessage("");
      setError(friendlyRequestError(err, "No se pudo completar la acción. Inténtalo de nuevo."));
    } finally {
      controlInFlightRef.current = false;
      setPendingControlAction(null);
    }
  }

  const introActive = screenMode === "game" && status?.phase === "intro" && (status.introRemainingMillis || 0) > 0;
  const countdownValue = screenMode === "game" && status?.phase === "countdown"
    ? Math.max(0, Math.ceil((status.countdownRemainingMillis || 0) / 1000))
    : 0;
  const recordingConfigured = venueSessionRecordingCanRequest(status ?? {});
  const recordingAvailable = status?.venueSessionRecordingAvailable !== false;
  function enterBrowserFullscreen() {
    const fullscreenDocument = document as Document & { webkitFullscreenElement?: Element | null };
    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) return;
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    const requestFullscreen = root.requestFullscreen?.bind(root) || root.webkitRequestFullscreen?.bind(root);
    if (!requestFullscreen) return;
    captureMenuEvent("fullscreen_requested");
    Promise.resolve(requestFullscreen()).catch((err) => {
      console.warn("Fullscreen request failed", err);
    });
  }

  if (!menuMirrorReady) {
    return (
      <WelcomeScreen
        connectionState={connectionState}
        floorReady={floorReady}
        previewGames={menuGames}
        readOnly
        message={message}
        error={error}
        starting={sessionStarting}
        recordingScope={menu.recordingPolicy}
        recordingConfigured={recordingConfigured}
        recordingAvailable={recordingAvailable}
        recordingSaving={recordingScopeSaving}
        remoteSessionRequest={null}
        onCancelRemoteStart={() => {}}
        onConfirmRemoteStart={() => {}}
        onStart={() => {}}
        onRecordingScopeChange={() => {}}
        onFullscreen={enterBrowserFullscreen}
      />
    );
  }

  if (!menu.sessionActive && screenMode !== "game") {
    return (
      <WelcomeScreen
        connectionState={connectionState}
        floorReady={floorReady}
        previewGames={menuGames}
        readOnly={readOnlyMirror}
        message={message}
        error={error}
        starting={sessionStarting}
        recordingScope={menu.recordingPolicy}
        recordingConfigured={recordingConfigured}
        recordingAvailable={recordingAvailable}
        recordingSaving={recordingScopeSaving}
        remoteSessionRequest={remoteSessionRequest}
        onCancelRemoteStart={dismissRemoteSessionStart}
        onConfirmRemoteStart={confirmRemoteSessionStart}
        onStart={() => void beginSession()}
        onRecordingScopeChange={(scope) => void setSessionRecordingScope(scope)}
        onFullscreen={enterBrowserFullscreen}
      />
    );
  }

  return (
    <main className={`app ${systemStatusClass} ${readOnlyMirror ? "read-only-mirror" : ""} ${keyboardTarget ? `keyboard-open keyboard-${keyboardTarget.kind}` : ""} ${screenMode === "game" ? "playing" : ""}`} inert={readOnlyMirror}>
      <header className="topbar" inert={teamOpen}>
        <div className="brand">
          <button className="brand-mark" type="button" aria-label="Pantalla completa" title="Pantalla completa" onClick={enterBrowserFullscreen} />
          <div className="brand-copy">
            <b>Motion Levels</b>
            <span>Quiosco</span>
          </div>
        </div>
        <nav className="category-tabs top-category-tabs" aria-label="Categorías de juegos">
          {categories.map((category) => (
            <button
              key={category.id}
              className={`tab ${menu.category === category.id ? "active" : ""}`}
              type="button"
              disabled={gameActive}
              aria-pressed={menu.category === category.id}
              onClick={() => {
                if (gameActive) return;
                const categoryGames = gamesForCategory(menuGames, category.id);
                const first = categoryGames[0];
                captureMenuEvent("category_selected", {
                  category: category.id,
                  game_count: categoryGames.length,
                  selected_game: first?.id,
                });
                setMenu((current) => {
                  // Empty categories keep an explicit empty selection. This
                  // distinguishes deliberate navigation from a stale saved
                  // game whose platform category changed during hydration.
                  const selectedGameID = first?.id || "";
                  const difficulty = first ? normalizedDifficultyForGame(first, current.difficulty) : current.difficulty;
                  const levelID = first?.levels?.length
                    ? closestLevelIDForDifficulty(first, current.selectedLevels[selectedGameID] || defaultLevelIDForDifficulty(first, difficulty), difficulty)
                    : "";
                  const selectedLevels = first?.levels?.length && current.selectedLevels[selectedGameID] !== levelID ? { ...current.selectedLevels, [selectedGameID]: levelID } : current.selectedLevels;
                  return {
                    ...current,
                    category: category.id,
                    difficulty,
                    selectedGame: selectedGameID,
                    selectedLevels,
                  };
                });
                setLevelBrowserGameID(null);
              }}
            >
              <span className="tab-icon" aria-hidden="true">
                {categoryIcon(category.id)}
              </span>
              <span>{category.label}</span>
            </button>
          ))}
        </nav>
        <div className="status-capsules">
          <span className={`system-status ${systemStatusClass}`} role="status" aria-live="polite">
            <span className="system-status-dot" aria-hidden="true" />
            {connectionLabel}
          </span>
          <button
            className={`capsule audio-btn ${status?.audioMuted ? "muted" : ""}`}
            type="button"
            onClick={() => sendGameControl("toggle_mute")}
            disabled={!audioControlAvailable(status) || connectionState !== "connection-on" || Boolean(pendingControlAction)}
            aria-busy={pendingControlAction === "toggle_mute" || undefined}
            aria-label={audioControlTitle(status)}
            title={audioControlTitle(status)}
          >
            {status?.audioMuted ? <VolumeMutedIcon /> : <VolumeIcon />}
          </button>
          <button
            ref={teamTriggerRef}
            className={`capsule equipo-btn ${rosterIssue ? "invalid" : ""}`}
            type="button"
            onClick={() => {
              if (gameActive) return;
              captureMenuEvent("team_opened", {
                player_count: activePlayers.length,
                selected_game: selectedGame.id,
              });
              setTeamOpen(true);
            }}
            disabled={gameActive}
            aria-haspopup="dialog"
            aria-expanded={teamOpen}
            aria-label={gameActive ? "Equipo no disponible durante la partida" : "Abrir equipo"}
            title={gameActive ? "Sal de la partida para cambiar el equipo" : undefined}
          >
            <span className="mini-avatars">
              {headerPlayers.slice(0, 8).map((player) => (
                <span key={player.id} style={{ "--pc": player.color } as CSSProperties} />
              ))}
            </span>
            <strong>{playerCountLabel}</strong>
          </button>
          <button
            className={`capsule settings-btn ${levelsUnlocked ? "active" : ""}`}
            type="button"
            onClick={openSettings}
            aria-label="Ajustes"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            title="Ajustes"
          >
            <GearIcon />
          </button>
        </div>
      </header>

      {screenMode === "game" ? (
        <GameControlScreen
          game={launchedGame}
          status={status}
          players={displayPlayers}
          allPlayers={displayPlayers.length > 0 ? displayPlayers : menu.players}
          levelMode={launchedLevelMode}
          selectedLevelID={selectedLevelFor(launchedGame)}
          challengeRun={challengeRunFor(launchedGame, menu)}
          freeRun={freeRunFor(launchedGame, menu)}
          difficulty={launchedDifficulty}
          supportedDifficulties={launchedSupportedDifficulties}
          difficultyLocked={launchedLevelActive}
          renderLevelOption={(level, options) => renderActiveLevelOption(launchedGame, level, options)}
          activeLevelLaunch={activeLevelLaunchView}
          ambient={isAmbientCard(launchedGame)}
          introActive={introActive}
          countdownValue={countdownValue}
          error={!floorReady && !isAmbientCard(launchedGame)
            ? "El suelo no está enviando pulsaciones. La partida queda protegida mientras reconectamos."
            : connectionState === "connection-off" ? "Conexión con el motor interrumpida. Reintentando automáticamente." : error}
          busy={connectionState !== "connection-on" || recordingGateBlocking || Boolean(launchingGameID || pendingControlAction || activeLevelLaunch)}
          recordingGateActionBusy={connectionState !== "connection-on" || Boolean(pendingControlAction)}
          pendingControlAction={pendingControlAction}
          onDifficultyChange={(difficulty) => {
            captureMenuEvent("difficulty_changed", {
              difficulty,
              engine_game: engineGameID(launchedGame),
              game: launchedGame.id,
              level: selectedLevelFor(launchedGame),
              source: "active_game",
            });
            setMenu((current) => ({ ...current, difficulty }));
          }}
          onLevelSelect={requestActiveLevelSwitch}
          onNextLevel={() => {
            const levels = levelsForDifficulty(launchedGame, launchedDifficulty);
            if (!levels.length) return;
            const statusLevelID = canonicalLevelID(launchedGame, status?.level || "", launchedDifficulty);
            const currentLevelID = statusLevelID && levels.some((level) => level.id === statusLevelID)
              ? statusLevelID
              : selectedLevelFor(launchedGame);
            const currentIndex = levels.findIndex((level) => level.id === currentLevelID);
            const nextLevel = currentIndex < 0 ? levels[0] : levels[(currentIndex + 1) % levels.length];
            if (nextLevel) requestActiveLevelSwitch(nextLevel.id);
          }}
          onPauseToggle={() => sendGameControl(status?.paused ? "resume" : "pause")}
          onRestart={() => setPendingGameControl("restart")}
          narrationSupported={supportsNarration(launchedGame)}
          onNarration={() => sendGameControl("narration")}
          exitLabel={launchedLevelActive && launchedLevelMode === "free" ? "Terminar nivel" : "Salir del juego"}
          onExit={() => setPendingGameControl("exit")}
          onRecordingGateAction={(action, gateId) => void sendGameControl(action, gateId)}
        />
      ) : (
      <section className="layout">
        {error || message ? (
          <div className={`kiosk-toast ${error ? "error" : ""}`} role="status" aria-live="polite">
            <span aria-hidden="true">{error ? "!" : "✓"}</span>
            {error || message}
          </div>
        ) : null}
        <div className={`drawer-backdrop ${teamOpen ? "open" : ""}`} onClick={() => setTeamOpen(false)} />
        <aside
          className={`panel team-panel team-drawer ${teamOpen ? "open" : ""}`}
          role="dialog"
          aria-modal={teamOpen || undefined}
          aria-label="Configuración del equipo"
          aria-hidden={!teamOpen}
          inert={!teamOpen}
          onKeyDown={(event) => trapKioskFocus(event, () => setTeamOpen(false))}
        >
          <div className="drawer-head">
            <div>
              <strong>Equipo</strong>
              <span>{playerCountLabel}</span>
            </div>
            <button ref={teamCloseRef} className="icon-button" type="button" aria-label="Cerrar equipo" onClick={() => setTeamOpen(false)}>
              <CloseIcon />
            </button>
          </div>
          <section className={`team-name ${keyboardTarget?.kind === "team" ? "editing" : ""}`}>
            <div className="team-name-head">
              <strong>Nombre del equipo</strong>
              <button className="btn compact name-refresh" type="button" onClick={regenerateTeamName}>
                <RestartIcon />
                Nuevo
              </button>
            </div>
            <input
              className="ph-no-capture"
              value={menu.teamName}
              maxLength={maxTeamNameLength}
              autoComplete="off"
              spellCheck={false}
              placeholder="Nombre del equipo"
              inputMode="none"
              data-name-field="team"
              onFocus={() => beginNameEdit({ kind: "team" })}
              onClick={() => openTouchKeyboard({ kind: "team" })}
              onBlur={() => {
                const target: KeyboardTarget = { kind: "team" };
                if (!keyboardTargetsMatch(touchKeyboardTargetRef.current, target)) finishNameEdit(target);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                openTouchKeyboard({ kind: "team" });
              }}
              onChange={(event) => setNameDraft({ kind: "team" }, event.target.value)}
            />
          </section>

          <section className="roster" aria-label="Jugadores">
            {menu.players.length === 0 ? (
              <div className="message roster-empty">
                {selectedGame.allowAnyPlayers ? "Este juego no necesita jugadores configurados." : "Añade un jugador para continuar."}
              </div>
            ) : null}
            {menu.players.map((player, index) => {
              const invalidPlayer = Boolean(rosterIssue?.playerIds.has(player.id));
              const editingPlayer = keyboardTarget?.kind === "player" && keyboardTarget.id === player.id;
              return (
                <article key={player.id} className={`player ph-no-capture ${player.active ? "" : "off"} ${invalidPlayer ? "invalid" : ""} ${editingPlayer ? "editing" : ""}`} style={{ "--pc": player.color, "--pc-ink": playerColorInk(player.color) } as CSSProperties}>
                  <button className="avatar" type="button" onClick={() => setColorPickerFor(player.id)} aria-label={`Elegir color de ${playerLabel(menu.players, player)}`}>
                    {avatarLabel(menu.players, player)}
                  </button>
                  <input
                    className="ph-no-capture"
                    value={player.name}
                    maxLength={maxPlayerNameLength}
                    aria-label={`Nombre del jugador ${index + 1}`}
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="none"
                    aria-invalid={invalidPlayer || undefined}
                    aria-describedby={invalidPlayer && rosterIssue ? "roster-issue" : undefined}
                    placeholder={`Jugador ${index + 1}`}
                    data-name-field={`player-${player.id}`}
                    onFocus={() => beginNameEdit({ kind: "player", id: player.id })}
                    onClick={() => openTouchKeyboard({ kind: "player", id: player.id })}
                    onBlur={() => {
                      const target: KeyboardTarget = { kind: "player", id: player.id };
                      if (!keyboardTargetsMatch(touchKeyboardTargetRef.current, target)) finishNameEdit(target);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      openTouchKeyboard({ kind: "player", id: player.id });
                    }}
                    onChange={(event) => setNameDraft({ kind: "player", id: player.id }, event.target.value)}
                  />
                  <div className="player-actions">
                    <button
                      className="icon-button"
                      type="button"
                      title={player.active ? "Descansar" : "Activar"}
                      aria-label={player.active ? `Poner a descansar a ${playerLabel(menu.players, player)}` : `Activar a ${playerLabel(menu.players, player)}`}
                      onClick={() => updatePlayer(player.id, { active: !player.active })}
                    >
                      {player.active ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button className="icon-button danger" type="button" title="Quitar" aria-label={`Quitar a ${playerLabel(menu.players, player)}`} onClick={() => setConfirmRemove(player.id)}>
                      <CloseIcon />
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          {rosterIssue ? (
            <div className="roster-issue" id="roster-issue" role="alert" aria-live="polite">
              <span aria-hidden="true">!</span>
              {rosterIssue.message}
            </div>
          ) : null}

          <section className="team-actions">
            <button className="btn" type="button" onClick={addPlayer} disabled={menu.players.length >= maxPlayers}>
              <PlusIcon />
              Añadir jugador
            </button>
            <button className="btn session-reset" type="button" onClick={() => setConfirmResetSession(true)}>
              <CloseIcon />
              Cerrar sesión
            </button>
          </section>

          <RecordingModePicker
            scope={menu.recordingPolicy}
            configured={recordingConfigured}
            available={recordingAvailable}
            saving={recordingScopeSaving}
            onChange={(scope) => void setSessionRecordingScope(scope)}
          />

          <button className="btn primary drawer-done" type="button" onClick={() => setTeamOpen(false)}>
            <CheckIcon />
            Listo
          </button>
        </aside>

        <section className="main-panel" inert={teamOpen}>
          <section className="browse-content">
            <section className="game-grid-panel" aria-labelledby="games-heading">
              <div className="section-head">
                <div>
                  <span className="micro">{browsingLevels ? "Elige nivel" : "Elige juego"}</span>
                  <h2 id="games-heading">{levelBrowserGame?.label || activeCategory.label}</h2>
                </div>
                {browsingLevels ? (
                  <div className="level-browser-actions">
                    <button className="btn compact back-to-games" type="button" onClick={() => setLevelBrowserGameID(null)}>
                      <ArrowLeftIcon />
                      Juegos
                    </button>
                  </div>
                ) : (
                  <span className="grid-count">{visibleGames.length} {visibleGames.length === 1 ? "modo" : "modos"}</span>
                )}
              </div>
              {browsingLevels && levelBrowserGame?.levels?.length ? (
                <section key={`${levelBrowserGame.id}-levels`} className="levels-grid" role="radiogroup" aria-label={`Niveles de ${levelBrowserGame.label}`}>
                  {levelBrowserLevels.map((level) => renderLevelOption(levelBrowserGame, level))}
                </section>
              ) : (
                <section key={menu.category} className={`games game-grid count-${Math.min(visibleGames.length, 5)}`} aria-label="Juegos">
                  {visibleGames.length === 0 ? (
                    <div className="empty-category" role="status">
                      <span className="empty-category-icon" aria-hidden="true"><GamepadIcon /></span>
                      <strong>Aún no hay juegos aquí</strong>
                      <p>Prueba otra categoría o vuelve a intentarlo.</p>
                      <div className="empty-category-actions">
                        <button className="btn" type="button" onClick={() => {
                          const featured = gamesForCategory(menuGames, "featured")[0] || menuGames[0];
                          if (!featured) return;
                          setMenu((current) => ({ ...current, category: "featured", selectedGame: featured.id }));
                        }}>
                          <ArrowLeftIcon />
                          Ir a destacados
                        </button>
                        <button className="btn primary" type="button" disabled={catalogRefreshing} onClick={() => refreshPlatformCatalog({ manual: true })}>
                          <RefreshIcon />
                          {catalogRefreshing ? "Actualizando" : "Volver a intentar"}
                        </button>
                      </div>
                    </div>
                  ) : visibleGames.map((game, index) => {
                    const future = Boolean(game.disabled);
                    const engineAvailable = isGameLaunchable(game);
                    const selected = selectedGame.id === game.id;
                    const active = selected && (status?.currentGame === runtimeGameID(game) || status?.currentGame === engineGameID(game));
                    const meta = gameCardMeta(game, active, selected);
                    return (
                      <button
                        key={game.id}
                        className={`card game-card ${future ? "disabled" : ""} ${!future && !engineAvailable ? "unavailable" : ""} ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                        style={{ "--c": game.color, "--crgb": hexToRGB(game.color), "--i": Math.min(index, 8) } as CSSProperties}
                        type="button"
                        disabled={future}
                        data-game-id={game.id}
                        aria-pressed={selected}
                        onClick={() => selectGameCard(game.id)}
                      >
                        {renderPartyPreview(game, { compact: true, rich: selected || active })}
                        <div className="game-body">
                          <h3>{game.label}</h3>
                          {meta ? (
                            <span className={`game-card-meta ${meta.className}`} aria-label={meta.ariaLabel}>
                              {meta.icon ? <span className="game-card-meta-icon" aria-hidden="true">{meta.icon}</span> : null}
                              <span>{meta.label}</span>
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </section>
              )}
            </section>

            <aside key={`${menu.category}:${categorySelectionValid ? selectedGame.id : "empty"}`} className={`panel detail-panel ${levelDetail ? "level-detail-panel" : ""} ${categorySelectionValid ? "" : "empty-detail-panel"}`} style={{ "--c": selectedGame.color, "--crgb": hexToRGB(selectedGame.color) } as CSSProperties} aria-label={categorySelectionValid ? "Juego seleccionado" : "Categoría vacía"}>
              {categorySelectionValid ? (
                <>
              <div className="detail-preview">
                {isPartyCard(selectedGame) ? renderPartyPreview(selectedGame, { rich: true }) : (
                  <Preview
                    src={levelPreviewSrc(selectedGame, selectedLevel, effectiveDifficulty)}
                    animationID={levelFallbackPreviewAnimationID(selectedGame, selectedLevel)}
                    revisionHash={selectedLevel?.previewRevisionHash || selectedGame.previewRevisionHash}
                  />
                )}
              </div>
              <div className="detail-copy">
                {levelDetail && selectedLevel ? (
                  <>
                    <section className="season-summary" aria-label="Juego actual">
                      <div className="detail-heading-row">
                        <span className="micro">Juego actual</span>
                      </div>
                      <div className="season-title-row">
                        <span className="season-title-main">
                          <h2>{selectedGame.label}</h2>
                        </span>
                        <span className="season-progress">
                          {selectedLevelIndex}/{selectedVisibleLevels.length || selectedGame.levels?.length}
                        </span>
                      </div>
                      <p>{selectedGame.description}</p>
                    </section>
                    <section className="season-level-row" aria-label="Nivel seleccionado">
                      <div className="season-level-copy">
                        <strong>{selectedLevelDisplayLabel}</strong>
                        <p>{selectedLevel.description}</p>
                      </div>
                    </section>
                    <section className="level-mode-panel" aria-label="Modo de niveles">
                      <div className="level-mode-toggle" role="group" aria-label="Cambiar modo de niveles">
                        <button
                          className={selectedLevelMode === "challenge" ? "active" : ""}
                          type="button"
                          aria-pressed={selectedLevelMode === "challenge"}
                          onClick={() => setLevelMode(selectedGame, "challenge")}
                        >
                          <span>Reto</span>
                          <small>{selectedChallengeProgressLabel}</small>
                        </button>
                        <button
                          className={selectedLevelMode === "free" ? "active" : ""}
                          type="button"
                          aria-pressed={selectedLevelMode === "free"}
                          onClick={() => setLevelMode(selectedGame, "free")}
                        >
                          <span>Libre</span>
                          <small>todos</small>
                        </button>
                      </div>
                    </section>
                    <section className="season-facts" aria-label="Resumen de partida">
                      <div>
                        <span>{isIndividualCard(selectedGame) ? "Jugador" : "Equipo"}</span>
                        <strong>{selectedGamePlayerRangeLabel}</strong>
                      </div>
                      <div>
                        <span>{selectedLevelMode === "challenge" ? "Reto" : "Mejor"}</span>
                        <strong>{selectedLevelMode === "challenge" ? selectedChallengeProgressLabel : selectedLevelBestLabel}</strong>
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    <div className="detail-heading-row">
                      <span className="micro">Seleccionado</span>
                    </div>
                    <h2>{selectedGame.label}</h2>
                    <p>{selectedGame.description}</p>
                    <section className="season-facts" aria-label="Resumen de partida">
                      {isAmbientCard(selectedGame) ? (
                        <>
                          <div>
                            <span>Estado</span>
                            <strong>{selectedGameActive ? "Activo" : "Listo"}</strong>
                          </div>
                          <div>
                            <span>Rotación</span>
                            <strong>Automática</strong>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <span>{isIndividualCard(selectedGame) ? "Jugador" : "Equipo"}</span>
                            <strong>{selectedGamePlayerRangeLabel}</strong>
                          </div>
                          <div>
                            <span>Duración</span>
                            <strong>{selectedGame.duration}</strong>
                          </div>
                        </>
                      )}
                    </section>
                    {isPartyCard(selectedGame) ? (
                      <div className="detail-rules">
                        <span className="micro">Orden de juegos</span>
                        <ul>
                          {selectedPartyMiniGames.length ? selectedPartyMiniGames.map((item, index) => {
                            const miniGame = menuGames.find((candidate) => candidate.id === item.gameId || engineGameID(candidate) === item.gameId);
                            const difficultyLabel = item.difficultyMode === "override" && item.difficulty
                              ? difficulties.find((difficulty) => difficulty.id === item.difficulty)?.label
                              : "hereda";
                            return (
                              <li key={`${item.gameId}-${index}`}>
                                {index + 1}. {miniGame?.label || item.label || item.gameId}{difficultyLabel ? ` · ${difficultyLabel}` : ""}
                              </li>
                            );
                          }) : (
                            <li>Sin minijuegos configurados todavía.</li>
                          )}
                        </ul>
                      </div>
                    ) : (
                      <div className="detail-rules">
                        <span className="micro">Reglas rápidas</span>
                        <ul>
                          {selectedGame.rules.slice(0, 3).map((rule) => (
                            <li key={rule}>{rule}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
                </>
              ) : (
                <div className="empty-detail">
                  <span className="micro">Sin selección</span>
                  <strong>Explora otra categoría</strong>
                  <p>Cuando haya nuevos modos disponibles aparecerán aquí automáticamente.</p>
                </div>
              )}
            </aside>
          </section>

          <section className="panel launch-bar" aria-label="Resumen de inicio">
            {categorySelectionValid ? (
              <>
            {usesDifficulty(selectedGame) ? (
              <div className="launch-difficulty-deck">
                <div className="launch-deck-label">
                  <span className="micro">Elige dificultad</span>
                </div>
                <div className="launch-difficulty" role="group" aria-label="Dificultad">
                  {difficulties.map((difficulty) => (
                    (() => {
                      const supported = selectedSupportedDifficulties.includes(difficulty.id);
                      return (
                        <button
                          key={difficulty.id}
                          className={`launch-difficulty-button ${effectiveDifficulty === difficulty.id ? "active" : ""} ${supported ? "" : "unavailable"}`}
                          style={{ "--difficulty-color": difficulty.color, "--difficulty-rgb": hexToRGB(difficulty.color) } as CSSProperties}
                          type="button"
                          disabled={!supported}
                          aria-pressed={effectiveDifficulty === difficulty.id}
                          aria-disabled={!supported}
                          title={supported ? undefined : "No disponible en este nivel"}
                          onClick={() => {
                            if (!supported) return;
                            captureMenuEvent("difficulty_changed", {
                              difficulty: difficulty.id,
                              engine_game: engineGameID(selectedGame),
                              game: selectedGame.id,
                              level: selectedLevel?.id || undefined,
                            });
                            setMenu((current) => ({ ...current, difficulty: difficulty.id }));
                          }}
                        >
                          <span className="difficulty-label">{difficulty.label}</span>
                          <StarRating difficulty={difficulty.id} label={difficulty.label} />
                        </button>
                      );
                    })()
                  ))}
                </div>
              </div>
            ) : (
              <div className="launch-difficulty-deck launch-difficulty-deck--summary">
                <div className="launch-deck-label">
                  <span className="micro">Listo para jugar</span>
                </div>
                <span className="launch-summary-pill">{selectedGame.players || "Listo"}</span>
              </div>
            )}
            {(() => {
              const engineAvailable = isGameLaunchable(selectedGame);
              const rosterBlocked = !isAmbientCard(selectedGame) && Boolean(rosterIssue);
              const levelBlocked = Boolean(selectedGame.levels?.length && !isLevelUnlocked(selectedGame, selectedLevelFor(selectedGame), menu));
              const catalogBlocked = catalogLoading && isPlatformLaunchableSource(selectedGame) && !canLaunchWhileCatalogRefreshes(selectedGame);
              const floorBlocked = !isAmbientCard(selectedGame) && !isScreensaverCard(selectedGame) && status?.pressureStreamConnected === false;
              const launching = launchingGameID === selectedGame.id;
              const ambientActive = isAmbientCard(selectedGame) && selectedGameActive;
              const blocked = launching || catalogBlocked || selectedGame.disabled || !engineAvailable || rosterBlocked || levelBlocked;
              const rosterAction = rosterBlocked && !launching && !catalogBlocked && !selectedGame.disabled && !levelBlocked;
              const launchDisabled = (blocked && !rosterAction) || ambientActive;
              const readyLabel = isAmbientCard(selectedGame) ? (ambientActive ? "Ambiente activo" : "Activar ambiente") : "Empezar partida";
              const blockedLabel = catalogBlocked
                ? "Sincronizando"
                : levelBlocked ? "Nivel bloqueado"
                  : rosterBlocked ? "Jugadores"
                    : selectedGame.disabled ? "Próximamente"
                      : connectionState === "connection-off" ? "Reconectando"
                        : connectionState === "connection-pending" ? "Preparando sala"
                          : floorBlocked ? "Suelo sin señal"
                          : !engineAvailable ? "No disponible" : readyLabel;
              const loadingVisual = launching || catalogBlocked;
              const handleLaunchAction = () => {
                if (rosterAction) {
                  captureMenuEvent("team_opened", {
                    player_count: activePlayers.length,
                    reason: "roster_blocked",
                    selected_game: selectedGame.id,
                  });
                  setTeamOpen(true);
                  return;
                }
                void launch(selectedGame.id, { resetChallengeRun: selectedLevelMode === "challenge" });
              };
              return (
                <div className="launch-actions">
                  {selectedGame.configVars?.length ? (
                    <button
                      className={`btn narration-toggle game-config-open ${menuConfigOverridesFor(selectedGame, menu) ? "active" : ""}`}
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => {
                        captureMenuEvent("game_config_opened", {
                          engine_game: engineGameID(selectedGame),
                          game: selectedGame.id,
                        });
                        setGameConfigOpen(true);
                      }}
                    >
                      <GearIcon />
                      Ajustes
                    </button>
                  ) : null}
                  {supportsNarration(selectedGame) ? (
                    <button
                      className={`btn narration-toggle ${narrationArmedFor(selectedGame) ? "active" : ""}`}
                      type="button"
                      aria-pressed={narrationArmedFor(selectedGame)}
                      onClick={() => setNarrationArmed(selectedGame, !narrationArmedFor(selectedGame))}
                    >
                      <BoltIcon />
                      {narrationArmedFor(selectedGame) ? "Con narración" : "Sin narración"}
                    </button>
                  ) : null}
                  <button className={`btn primary play ${loadingVisual ? "loading" : ""} ${rosterAction ? "roster-action" : ""}`} type="button" disabled={launchDisabled} aria-busy={loadingVisual} onClick={handleLaunchAction}>
                    {loadingVisual ? (
                      <>
                        <span className="launch-spinner" aria-hidden="true" />
                        {launching ? "Cargando" : "Sincronizando"}
                      </>
                    ) : ambientActive ? (
                      <>
                        <CheckIcon />
                        {readyLabel}
                      </>
                    ) : blocked ? (
                      <>
                        {rosterBlocked ? <TeamIcon /> : levelBlocked || selectedGame.disabled || blockedLabel === "No disponible" ? <QuestionIcon /> : <PlayIcon />}
                        {blockedLabel}
                      </>
                    ) : (
                      <>
                        <PlayIcon />
                        {readyLabel}
                      </>
                    )}
                  </button>
                </div>
              );
            })()}
              </>
            ) : (
              <div className="empty-launch">
                <div>
                  <span className="micro">Catálogo</span>
                  <strong>Explora las categorías para continuar</strong>
                </div>
                <span className="empty-launch-status">Sin selección</span>
              </div>
            )}
          </section>
        </section>
      </section>
      )}

      {pickerPlayer ? (
        <ColorPicker
          player={pickerPlayer}
          takenColors={new Set(menu.players.filter((player) => player.active && player.id !== pickerPlayer.id).map((player) => player.color.toLowerCase()))}
          onPick={(color) => {
            updatePlayer(pickerPlayer.id, { color });
            setColorPickerFor(null);
          }}
          onClose={() => setColorPickerFor(null)}
        />
      ) : null}

      {removePlayer ? (
        <ConfirmDialog
          title="¿Quitar jugador?"
          body={`Se quitará a ${playerLabel(menu.players, removePlayer)} del equipo.`}
          confirmLabel="Quitar"
          cancelLabel="Cancelar"
          onConfirm={() => deletePlayer(removePlayer.id)}
          onCancel={() => setConfirmRemove(null)}
          restoreFocusFallback={teamDrawerFocusFallback}
        />
      ) : null}

      {confirmResetSession ? (
        <ConfirmDialog
          title="¿Cerrar sesión?"
          body="Se cerrará el equipo actual, se limpiará el progreso local de la sesión y volveremos a la pantalla de inicio."
          confirmLabel="Cerrar sesión"
          cancelLabel="Cancelar"
          onConfirm={() => void closeSession("manual")}
          onCancel={() => setConfirmResetSession(false)}
        />
      ) : null}

      {pendingGameControl ? (
        <ConfirmDialog
          title={pendingGameControl === "restart" ? "¿Reiniciar partida?" : launchedLevelActive && launchedLevelMode === "free" ? "¿Terminar nivel?" : "¿Salir del juego?"}
          body={pendingGameControl === "restart"
            ? "El progreso de la partida actual empezará de nuevo."
            : launchedLevelActive && launchedLevelMode === "free"
              ? "Se detendrá este nivel y podrás elegir otro."
              : "La partida actual terminará y volverás al menú."}
          confirmLabel={pendingGameControl === "restart" ? "Reiniciar" : launchedLevelActive && launchedLevelMode === "free" ? "Terminar nivel" : "Salir"}
          cancelLabel="Seguir jugando"
          onConfirm={() => {
            const action = pendingGameControl;
            setPendingGameControl(null);
            if (action === "restart") void restartLaunchedGame();
            else void sendGameControl("exit");
          }}
          onCancel={() => setPendingGameControl(null)}
        />
      ) : null}

      {pendingLevelSwitch && pendingLevelSwitchGame && pendingLevelSwitchLevel ? (
        <ConfirmDialog
          title="¿Cambiar nivel?"
          body={`Se detendrá el nivel actual y empezará ${playerLevelLabel(pendingLevelSwitchLevel, logicalLevelIndexForGame(pendingLevelSwitchGame, pendingLevelSwitchLevel.id))}.`}
          confirmLabel="Cambiar"
          cancelLabel="Cancelar"
          onConfirm={() => void switchLaunchedLevel(pendingLevelSwitchGame, pendingLevelSwitchLevel.id, true, activeLevelModeFor(pendingLevelSwitchGame, menu, status))}
          onCancel={() => setPendingLevelSwitch(null)}
        />
      ) : null}

      {gameConfigOpen && selectedGame.configVars?.length ? (
        <GameConfigDialog
          game={selectedGame}
          overrides={menu.gameConfig[selectedGame.id]}
          onChange={(key, value) => {
            captureMenuEvent("game_config_changed", {
              engine_game: engineGameID(selectedGame),
              game: selectedGame.id,
              key,
              value,
            });
            setGameConfigValue(selectedGame, key, value);
          }}
          onReset={() => resetGameConfig(selectedGame)}
          onClose={() => setGameConfigOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <OperatorSettingsDialog
          unlocked={settingsUnlocked}
          pin={settingsPin}
          error={settingsError}
          lockedOut={Date.now() < settingsLockoutUntil}
          levelsUnlocked={levelsUnlocked}
          envUnlockLevels={envUnlockLevels}
          engineLabel={engineLabel}
          floorLabel={floorReady ? "Conectado" : "Sin señal"}
          audioLabel={audioStatusLabel(status)}
          catalogLabel={catalogRefreshing ? "Actualizando" : `${menuGames.length} ${menuGames.length === 1 ? "modo" : "modos"}`}
          onTypeDigit={typeSettingsPinDigit}
          onBackspace={() => {
            setSettingsError("");
            setSettingsPin((current) => current.slice(0, -1));
          }}
          onClear={() => {
            setSettingsError("");
            setSettingsPin("");
          }}
          onSubmit={() => submitSettingsPin()}
          onToggleLevels={() => setOperatorUnlockLevels(!menu.operatorUnlockLevels)}
          onClose={closeSettings}
        />
      ) : null}

      {keyboardTarget ? (
        <TouchKeyboard
          title={keyboardTitle()}
          value={keyboardValue()}
          placeholder={keyboardTarget.kind === "team" ? "Nombre del equipo" : "Nombre del jugador"}
          onType={typeKey}
          onBackspace={() => setKeyboardValue(keyboardValue().slice(0, -1))}
          onClear={() => setKeyboardValue("")}
          onDone={() => finishNameEdit(keyboardTarget, true)}
        />
      ) : null}
    </main>
  );
}

function FloorOnlyApp() {
  return (
    <main className="app floor-only-app">
      <LiveFloorView />
    </main>
  );
}

function WelcomeScreen({
  connectionState,
  floorReady,
  previewGames,
  readOnly,
  message,
  error,
  starting,
  recordingScope,
  recordingConfigured,
  recordingAvailable,
  recordingSaving,
  remoteSessionRequest,
  onCancelRemoteStart,
  onConfirmRemoteStart,
  onRecordingScopeChange,
  onStart,
  onFullscreen,
}: {
  connectionState: ConnectionState;
  floorReady: boolean;
  previewGames?: GameCard[];
  readOnly?: boolean;
  message: string;
  error: string;
  starting: boolean;
  recordingScope: RecordingScope;
  recordingConfigured: boolean;
  recordingAvailable: boolean;
  recordingSaving: boolean;
  remoteSessionRequest: RemoteSessionRequest | null;
  onCancelRemoteStart: () => void;
  onConfirmRemoteStart: () => void;
  onRecordingScopeChange: (scope: RecordingScope) => void;
  onStart: () => void;
  onFullscreen: () => void;
}) {
  const availableGames = previewGames?.length ? previewGames : games;
  const welcomeGame = availableGames.find((game) => game.levels?.length && game.featured) || availableGames.find((game) => game.levels?.length);
  const welcomeLevel = welcomeGame?.levels?.[0];
  const welcomePreviewSrc = welcomeGame ? levelPreviewSrc(welcomeGame, welcomeLevel, "easy") : undefined;
  const welcomePreviewAnimation = welcomeGame ? levelFallbackPreviewAnimationID(welcomeGame, welcomeLevel) : "lava";
  const systemStatusClass = connectionState === "connection-on" && !floorReady ? "floor-off" : connectionState;
  const connectionLabel = systemStatusLabel(connectionState, floorReady);
  return (
    <main className={`app welcome-app ${systemStatusClass} ${readOnly ? "read-only-mirror" : ""}`} inert={readOnly}>
      {error || message ? (
        <div className={`kiosk-toast ${error ? "error" : ""}`} role="status" aria-live="polite">
          <span aria-hidden="true">{error ? "!" : "✓"}</span>
          {error || message}
        </div>
      ) : null}
      <section className="welcome-screen" aria-label="Inicio">
        <div className="welcome-copy">
          <button className="welcome-mark" type="button" aria-label="Pantalla completa" title="Pantalla completa" onClick={onFullscreen} />
          <span className={`system-status welcome-status ${systemStatusClass}`} role="status" aria-live="polite">
            <span className="system-status-dot" aria-hidden="true" />
            {connectionLabel}
          </span>
          <h1>Motion Levels</h1>
          <p>Preparad el equipo, elegid un reto y jugad sobre el suelo LED.</p>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <div className="welcome-floor" style={{ "--crgb": welcomeGame ? hexToRGB(welcomeGame.color) : "47, 216, 108" } as CSSProperties}>
            <Preview src={welcomePreviewSrc} animationID={welcomePreviewAnimation} promoteAnimation />
          </div>
        </div>
        {remoteSessionRequest ? (
          <section className="remote-session-card" aria-label="Reserva pendiente">
            <div>
              <span className="micro">Reserva desde plataforma</span>
              <strong className="ph-mask">{remoteSessionRequest.teamName}</strong>
              <p>
                {remoteSessionRequest.room} · {remoteSessionPlayerCopy(remoteSessionRequest)}
                {remoteSessionRequest.startsAt ? ` · ${formatRemoteStartTime(remoteSessionRequest.startsAt)}` : ""}
              </p>
            </div>
            <div className="remote-session-card__actions">
              <button className="btn compact" type="button" onClick={onCancelRemoteStart} disabled={starting}>
                Ignorar
              </button>
              <button className="btn primary" type="button" onClick={onConfirmRemoteStart} disabled={starting} aria-busy={starting || undefined}>
                <PlayIcon />
                {starting ? "Preparando sesión" : "Confirmar sesión"}
              </button>
            </div>
          </section>
        ) : (
          <section className="welcome-session-controls" aria-label="Nueva sesión">
            <RecordingModePicker
              scope={recordingScope}
              configured={recordingConfigured}
              available={recordingAvailable}
              saving={recordingSaving}
              disabled={readOnly || starting}
              variant="welcome"
              onChange={onRecordingScopeChange}
            />
            <button className="btn primary welcome-start" type="button" onClick={onStart} disabled={readOnly || starting} aria-busy={starting || undefined}>
              <PlayIcon />
              {readOnly ? "Esperando menú" : starting ? "Preparando sesión" : "Comenzar"}
            </button>
          </section>
        )}
      </section>
    </main>
  );
}

function RecordingModePicker({
  scope,
  configured,
  available,
  saving,
  disabled = false,
  variant = "drawer",
  onChange,
}: {
  scope: RecordingScope;
  configured: boolean;
  available: boolean;
  saving: boolean;
  disabled?: boolean;
  variant?: "drawer" | "welcome";
  onChange: (scope: RecordingScope) => void;
}) {
  const canRetryActiveMode = variant === "drawer" && configured && !available && scope !== "off";
  const status = !configured
    ? "Servicio no configurado"
    : available
      ? "Elige cuándo empieza un vídeo nuevo"
      : canRetryActiveMode
        ? "Servicio sin conexión · toca el modo activo para reintentar"
        : variant === "welcome"
          ? "Elige un modo; se intentará al iniciar la sesión"
          : "Elige un modo para activar y reintentar";
  const labelID = `recording-mode-label-${variant}`;

  return (
    <section
      className={`recording-picker recording-picker--${variant} ${scope === "off" ? "off" : "on"} ${!configured ? "unavailable" : available ? "" : "degraded"} ${saving ? "saving" : ""}`}
      aria-busy={saving || undefined}
    >
      <div className="recording-picker__head" id={labelID}>
        <span className="recording-status-dot" aria-hidden="true" />
        <span>
          <strong>{available ? "Grabación" : canRetryActiveMode ? "Reintentar grabación" : configured ? "Grabación sin conexión" : "Grabación no disponible"}</strong>
          <small>{status}</small>
        </span>
      </div>
      <div className="recording-options" role="group" aria-labelledby={labelID}>
        {recordingModeOptions.map((option) => {
          const selected = scope === option.scope;
          return (
            <button
              key={option.scope}
              className={`recording-option ${selected ? "selected" : ""}`}
              type="button"
              data-recording-scope={option.scope}
              aria-pressed={selected}
              disabled={disabled || saving || (option.scope !== "off" && !configured)}
              onClick={() => onChange(option.scope)}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function remoteSessionPlayerCopy(request: RemoteSessionRequest) {
  const reserved = `${request.playerCount} ${request.playerCount === 1 ? "reservado" : "reservados"}`;
  if (request.configuredPlayerCount === request.playerCount) {
    return `${request.playerCount} ${request.playerCount === 1 ? "jugador" : "jugadores"}`;
  }
  return `${reserved} · ${request.configuredPlayerCount} en menú`;
}

function formatRemoteStartTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" }).format(date);
}

function trapKioskFocus(event: ReactKeyboardEvent<HTMLElement>, onDismiss?: () => void) {
  if (event.key === "Escape" && onDismiss) {
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function KioskDialogLayer({
  children,
  className = "modal-overlay",
  label,
  onDismiss,
  restoreFocus = true,
  restoreFocusFallback,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onDismiss?: () => void;
  restoreFocus?: boolean;
  restoreFocusFallback?: () => HTMLElement | null;
}) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The full-screen layer, aria-modal contract and focus trap isolate the
    // dialog. Sibling inert state remains React-owned so cleanup cannot restore
    // a stale snapshot after a simultaneous session or drawer transition.
    const frame = window.requestAnimationFrame(() => {
      layer.querySelector<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (!restoreFocus) return;
      window.requestAnimationFrame(() => {
        const canReceiveFocus = (element: HTMLElement | null): element is HTMLElement => Boolean(
          element
          && element.isConnected
          && !element.matches(":disabled")
          && !element.closest("[inert], [aria-hidden='true']")
          && element.getClientRects().length > 0
        );
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (active !== document.body && canReceiveFocus(active)) return;
        const fallback = restoreFocusFallback?.() || null;
        const requested = canReceiveFocus(returnFocus)
          ? returnFocus
          : canReceiveFocus(fallback)
            ? fallback
            : Array.from(document.querySelectorAll<HTMLElement>(
              "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
            )).find((element) => canReceiveFocus(element)) || null;
        requested?.focus({ preventScroll: true });
      });
    };
  }, [restoreFocus, restoreFocusFallback]);

  return (
    <div
      ref={layerRef}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={(event) => trapKioskFocus(event, onDismiss)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      {children}
    </div>
  );
}

function ColorPicker({
  player,
  takenColors,
  onPick,
  onClose,
}: {
  player: Player;
  takenColors: Set<string>;
  onPick: (color: string) => void;
  onClose: () => void;
}) {
  return (
    <KioskDialogLayer label="Elegir color" onDismiss={onClose}>
      <div className="modal color-picker-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <strong>Elige un color</strong>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="swatch-grid">
          {playerColors.map((color, index) => {
            const selected = color.toLowerCase() === player.color.toLowerCase();
            const taken = !selected && takenColors.has(color.toLowerCase());
            return (
              <button
                key={color}
                className={`swatch ${selected ? "selected" : ""} ${taken ? "taken" : ""}`}
                style={{ "--pc": color, "--pc-ink": playerColorInk(color) } as CSSProperties}
                type="button"
                disabled={taken}
                aria-label={taken ? `${playerColorNames[index]} en uso` : playerColorNames[index]}
                aria-pressed={selected}
                onClick={() => onPick(color)}
              >
                <span className="swatch-name">{playerColorNames[index]}</span>
                <span className="swatch-state">{selected ? "Elegido" : taken ? "En uso" : "Disponible"}</span>
                {selected ? <CheckIcon /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </KioskDialogLayer>
  );
}

function GameConfigDialog({
  game,
  overrides,
  onChange,
  onReset,
  onClose,
}: {
  game: GameCard;
  overrides: GameConfigValues | undefined;
  onChange: (key: string, value: number | boolean | string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const vars = game.configVars || [];
  const hasOverrides = vars.some((item) => {
    const stored = overrides?.[item.key];
    return stored !== undefined && stored !== item.default;
  });
  return (
    <KioskDialogLayer label={`Ajustes de ${game.label}`} onDismiss={onClose}>
      <div className="modal game-config-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="micro">{game.label}</span>
            <strong>Ajustes de partida</strong>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar ajustes de partida" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="game-config-list">
          {vars.map((item) => (
            <GameConfigControl key={item.key} item={item} value={configVarValue(item, overrides)} onChange={(value) => onChange(item.key, value)} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onReset} disabled={!hasOverrides}>
            <RestartIcon />
            Restablecer
          </button>
          <button className="btn primary" type="button" onClick={onClose}>
            <CheckIcon />
            Listo
          </button>
        </div>
      </div>
    </KioskDialogLayer>
  );
}

function GameConfigControl({
  item,
  value,
  onChange,
}: {
  item: GameConfigVar;
  value: number | boolean | string | undefined;
  onChange: (value: number | boolean | string) => void;
}) {
  const changed = value !== undefined && item.default !== undefined && value !== item.default;
  return (
    <div className={`game-config-row ${changed ? "changed" : ""}`}>
      <div className="game-config-copy">
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </div>
      {item.type === "bool" ? (
        <button
          className={`game-config-toggle ${value === true ? "active" : ""}`}
          type="button"
          role="switch"
          aria-checked={value === true}
          aria-label={item.label}
          onClick={() => onChange(!(value === true))}
        >
          <span>{value === true ? "Sí" : "No"}</span>
          <span className="switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
      ) : item.type === "enum" ? (
        <div className="game-config-options" role="group" aria-label={item.label}>
          {(item.options || []).map((option) => (
            <button
              key={option.value}
              className={`game-config-option ${value === option.value ? "active" : ""}`}
              type="button"
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
            >
              {option.label || option.value}
            </button>
          ))}
        </div>
      ) : (
        <GameConfigStepper item={item} value={value} onChange={onChange} />
      )}
    </div>
  );
}

function GameConfigStepper({
  item,
  value,
  onChange,
}: {
  item: GameConfigVar;
  value: number | boolean | string | undefined;
  onChange: (value: number) => void;
}) {
  const step = item.step && item.step > 0 ? item.step : 1;
  const fallback = typeof item.default === "number" ? item.default : item.min ?? 0;
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  function clampConfigNumber(next: number): number {
    if (item.min !== undefined) next = Math.max(item.min, next);
    if (item.max !== undefined) next = Math.min(item.max, next);
    return item.type === "int" ? Math.round(next) : Math.round(next * 100) / 100;
  }
  return (
    <div className="game-config-stepper" aria-label={item.label}>
      <button
        type="button"
        aria-label={`Bajar ${item.label}`}
        disabled={item.min !== undefined && numeric <= item.min}
        onClick={() => onChange(clampConfigNumber(numeric - step))}
      >
        −
      </button>
      <strong>{numeric}</strong>
      <button
        type="button"
        aria-label={`Subir ${item.label}`}
        disabled={item.max !== undefined && numeric >= item.max}
        onClick={() => onChange(clampConfigNumber(numeric + step))}
      >
        +
      </button>
    </div>
  );
}

function audioControlAvailable(status: EngineStatus | null | undefined): boolean {
  return Boolean(status?.audioEnabled && status.audioOutputState !== "failed" && status.audioOutputState !== "disabled");
}

function audioControlTitle(status: EngineStatus | null | undefined): string {
  if (!status?.audioEnabled || status.audioOutputState === "disabled") return "Audio no disponible";
  if (status.audioOutputState === "failed") return "Salida de audio no disponible";
  if (status.audioOutputState === "checking") return "Comprobando salida de audio";
  if (status.audioOutputState === "suspended") return status.audioMuted ? "Activar audio" : "Silenciar audio";
  return status.audioMuted ? "Activar audio" : "Silenciar audio";
}

function audioStatusLabel(status: EngineStatus | null | undefined): string {
  if (!status?.audioEnabled || status.audioOutputState === "disabled") return "No disponible";
  if (status.audioOutputState === "failed") return "Error de salida";
  if (status.audioOutputState === "checking") return "Comprobando";
  if (status.audioOutputState === "suspended") return "En espera";
  return status.audioMuted ? "Silenciado" : "Activo";
}

function OperatorSettingsDialog({
  unlocked,
  pin,
  error,
  lockedOut,
  levelsUnlocked,
  envUnlockLevels,
  engineLabel,
  floorLabel,
  audioLabel,
  catalogLabel,
  onTypeDigit,
  onBackspace,
  onClear,
  onSubmit,
  onToggleLevels,
  onClose,
}: {
  unlocked: boolean;
  pin: string;
  error: string;
  lockedOut: boolean;
  levelsUnlocked: boolean;
  envUnlockLevels: boolean;
  engineLabel: string;
  floorLabel: string;
  audioLabel: string;
  catalogLabel: string;
  onTypeDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
  onToggleLevels: () => void;
  onClose: () => void;
}) {
  return (
    <KioskDialogLayer label="Ajustes" onDismiss={onClose}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="micro">Quiosco</span>
            <strong>Ajustes</strong>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar ajustes" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="settings-content">
          {unlocked ? (
            <>
              <section className="settings-version-card" aria-label="Versión del menú">
                <span className="micro">Diagnóstico</span>
                <strong>{__MOTION_LEVELS_GAMES_BUILD_VERSION__}</strong>
                <small className="settings-build-revision">Revisión {__MENU_BUILD_REVISION__}</small>
                <div className="settings-health" aria-label="Estado del sistema">
                  <div className={engineLabel === "Conectado" ? "ok" : "warn"}><span>Motor</span><b>{engineLabel}</b></div>
                  <div className={floorLabel === "Conectado" ? "ok" : "danger"}><span>Suelo</span><b>{floorLabel}</b></div>
                  <div className={audioLabel === "Activo" ? "ok" : "warn"}><span>Audio</span><b>{audioLabel}</b></div>
                  <div className={catalogLabel === "Actualizando" ? "warn" : "ok"}><span>Catálogo</span><b>{catalogLabel}</b></div>
                </div>
              </section>
              <section className="settings-section" aria-label="Opciones de operador">
                <div className="operator-unlocked-banner">
                  <CheckIcon />
                  <span>Modo operador desbloqueado</span>
                </div>
                <div className="settings-copy">
                  <span className="micro">Operador</span>
                  <p>Opciones protegidas para mantenimiento y pruebas.</p>
                </div>
                <button className={`settings-toggle ${levelsUnlocked ? "active" : ""}`} type="button" onClick={onToggleLevels} disabled={envUnlockLevels} aria-pressed={levelsUnlocked}>
                  <span>
                    <strong>Mostrar todos los niveles</strong>
                    <small>{envUnlockLevels ? "Activado por entorno" : levelsUnlocked ? "Todos los niveles visibles" : "Progreso normal"}</small>
                  </span>
                  <span className="switch-track" aria-hidden="true"><span /></span>
                </button>
              </section>
            </>
          ) : (
            <section className="pin-panel" aria-label="PIN operador">
              <div className="settings-copy">
                <span className="micro">Operador</span>
                <p>Introduce el PIN solo para desbloquear opciones de mantenimiento.</p>
              </div>
              <div className={`pin-dots ${error ? "error" : ""}`} aria-label={`${pin.length} de 6 dígitos`}>
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index} className={index < pin.length ? "filled" : ""} />
                ))}
              </div>
              {error ? <p className="pin-error">{error}</p> : <p className="pin-error placeholder">{"\u00a0"}</p>}
              <div className="pin-keypad" aria-label="Teclado PIN">
                {"123456789".split("").map((digit) => (
                  <button key={digit} className="pin-key" type="button" onClick={() => onTypeDigit(digit)} disabled={lockedOut}>
                    {digit}
                  </button>
                ))}
                <button className="pin-key secondary" type="button" onClick={onClear} disabled={lockedOut}>
                  C
                </button>
                <button className="pin-key" type="button" onClick={() => onTypeDigit("0")} disabled={lockedOut}>
                  0
                </button>
                <button className="pin-key secondary" type="button" onClick={onBackspace} aria-label="Borrar dígito" disabled={lockedOut}>
                  <BackspaceIcon />
                </button>
              </div>
              <button className="btn primary settings-submit" type="button" onClick={onSubmit} disabled={lockedOut || pin.length !== 6}>
                <CheckIcon />
                Entrar
              </button>
            </section>
          )}
        </div>
      </div>
    </KioskDialogLayer>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  restoreFocusFallback,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  restoreFocusFallback?: () => HTMLElement | null;
}) {
  return (
    <KioskDialogLayer label={title} onDismiss={onCancel} restoreFocusFallback={restoreFocusFallback}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
        </div>
        <p className="modal-body ph-mask">{body}</p>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="btn danger" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </KioskDialogLayer>
  );
}

function GameControlScreen({
  game,
  status,
  players,
  allPlayers,
  levelMode,
  selectedLevelID,
  challengeRun,
  freeRun,
  difficulty,
  supportedDifficulties,
  difficultyLocked,
  renderLevelOption,
  activeLevelLaunch,
  ambient,
  introActive,
  countdownValue,
  error,
  busy,
  recordingGateActionBusy,
  pendingControlAction,
  onDifficultyChange,
  onLevelSelect,
  onNextLevel,
  onPauseToggle,
  onRestart,
  narrationSupported,
  onNarration,
  exitLabel,
  onExit,
  onRecordingGateAction,
}: {
  game: GameCard;
  status: EngineStatus | null;
  players: Player[];
  allPlayers: Player[];
  levelMode: LevelMode;
  selectedLevelID: string;
  challengeRun: ChallengeRun | null;
  freeRun: FreeRun | null;
  difficulty: DifficultyID;
  supportedDifficulties: DifficultyID[];
  difficultyLocked: boolean;
  renderLevelOption: (level: NonNullable<GameCard["levels"]>[number], options: {
    activeLevelID: string;
    launchingLevelID: string | null;
    launchPhase: ActiveLevelLaunchPhase | null;
    levelMode: LevelMode;
    selectable: boolean;
    onSelect: (levelID: string) => void;
  }) => ReactNode;
  activeLevelLaunch: ActiveLevelLaunch | null;
  ambient: boolean;
  introActive: boolean;
  countdownValue: number;
  error: string;
  busy: boolean;
  recordingGateActionBusy: boolean;
  pendingControlAction: ControlGameAction | null;
  onDifficultyChange: (difficulty: DifficultyID) => void;
  onLevelSelect: (levelID: string) => void;
  onNextLevel: () => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  narrationSupported: boolean;
  onNarration: () => void;
  exitLabel: string;
  onExit: () => void;
  onRecordingGateAction: (action: RecordingGateAction, gateId: string) => void;
}) {
  const paused = Boolean(status?.paused);
  const recordingGate = status?.recordingGate;
  const recordingGateProjection = recordingGateMenuProjection(recordingGate, status?.allowedControls);
  const pendingRecordingGateAction = pendingControlAction && isRecordingGateAction(pendingControlAction)
    ? pendingControlAction
    : null;
  const levelModeFree = levelMode === "free";
  const levels = levelsForDifficulty(game, difficulty);
  const hasLevels = levels.length > 0;
  const canonicalStatusLevelID = canonicalLevelID(game, status?.level || "", difficulty);
  const statusLevelID = canonicalStatusLevelID && levels.some((level) => level.id === canonicalStatusLevelID) ? canonicalStatusLevelID : "";
  const currentLevelID = statusLevelID || closestLevelIDForDifficulty(game, selectedLevelID || levels[0]?.id || "", difficulty);
  const currentLevel = levels.find((level) => level.id === currentLevelID);
  const currentLevelIndex = currentLevel ? levels.findIndex((level) => level.id === currentLevel.id) : -1;
  const launchingLevel = activeLevelLaunch ? levels.find((level) => level.id === activeLevelLaunch.levelID) : undefined;
  const launchingLevelIndex = launchingLevel ? levels.findIndex((level) => level.id === launchingLevel.id) : -1;
  const visibleLevel = launchingLevel || currentLevel;
  const visibleLevelIndex = launchingLevel ? launchingLevelIndex : currentLevelIndex;
  const launchingLevelLabel = launchingLevel ? playerLevelLabel(launchingLevel, launchingLevelIndex) : "";
  const totalMillis = hasLevels ? 0 : Math.max(0, Math.round((game.estimatedDurationSeconds || 0) * 1000));
  const elapsedMillis = Math.max(0, Math.round(status?.elapsedMillis || 0));
  const activeLevelElapsedMillis = activeLevelAttempt(status, game, currentLevelID) ? elapsedMillis : 0;
  const freeElapsedMillis = Math.max(0, Math.round(freeRun?.totalElapsedMillis || 0)) + activeLevelElapsedMillis;
  const challengeElapsedMillis = Math.max(0, Math.round(challengeRun?.totalElapsedMillis || 0)) + activeLevelElapsedMillis;
  const challengeRemainingMillis = totalMillis > 0 ? Math.max(0, totalMillis - challengeElapsedMillis) : 0;
  const timeLabel = hasLevels
    ? levelModeFree
      ? formatRuntimeTime(freeElapsedMillis)
      : totalMillis > 0 ? formatRuntimeTime(challengeRemainingMillis) : formatRuntimeTime(challengeElapsedMillis)
    : totalMillis > 0 ? formatRuntimeTime(Math.max(0, totalMillis - elapsedMillis)) : formatRuntimeTime(elapsedMillis);
  const timeCaption = hasLevels ? (levelModeFree ? "Tiempo transcurrido" : totalMillis > 0 ? "Tiempo restante" : "Tiempo transcurrido") : totalMillis > 0 ? "Restante" : "Tiempo";
  const score = scoreFromStatus(status);
  const currentLives = teamLivesFromPlayers(status?.players);
  const lifeMeterKey = `${status?.sessionId || ""}:${status?.currentGame || game.id}:${status?.level || ""}:${difficulty}`;
  const previousLifeMeterRef = useRef<{ key: string; lives: number | null; slots: number }>({ key: "", lives: null, slots: 0 });
  const previousLifeMeter = previousLifeMeterRef.current.key === lifeMeterKey
    ? previousLifeMeterRef.current
    : { key: lifeMeterKey, lives: null, slots: 0 };
  const lifeMeter = lifeMeterModel(currentLives, previousLifeMeter.lives, previousLifeMeter.slots);
  useEffect(() => {
    previousLifeMeterRef.current = {
      key: lifeMeterKey,
      lives: lifeMeter.visible && !lifeMeter.unlimited ? lifeMeter.lives : null,
      slots: lifeMeter.visible && !lifeMeter.unlimited ? lifeMeter.slots : 0,
    };
  }, [lifeMeter.lives, lifeMeter.slots, lifeMeter.unlimited, lifeMeter.visible, lifeMeterKey]);
  const completedCount = levels.filter((level) => challengeRun?.completedLevels[level.id] !== undefined).length;
  const progressLabel = hasLevels ? `${completedCount}/${levels.length}` : "0/0";
  const stopped = isStoppedRuntimePhase(status);
  const attemptSummary = hasLevels ? levelAttemptSummary(status, game, currentLevelID) : { attempts: 0, failures: 0 };
  const challengeAttemptCount = Math.max(0, Math.round(challengeRun?.attemptCount || 0)) + (activeLevelAttempt(status, game, currentLevelID) ? 1 : 0);
  const attemptCount = hasLevels && !levelModeFree ? Math.max(1, challengeAttemptCount) : Math.max(1, attemptSummary.attempts || 0);
  const phaseLabel = recordingGateProjection
    ? recordingGateProjection.title
    : activeLevelLaunch
      ? activeLevelLaunch.phase === "stopping" ? "Deteniendo nivel" : `Cargando ${launchingLevelLabel || "nivel"}`
      : ambient ? "Animación en curso" : stopped ? "Nivel detenido" : introActive ? "Narración inicial" : countdownValue > 0 ? "Preparando salida" : paused ? "Pausado" : "En curso";
  return (
    <section className={`game-control-screen ${hasLevels ? "with-levels" : ""}`} style={{ "--c": game.color, "--crgb": hexToRGB(game.color) } as CSSProperties}>
      {recordingGate && recordingGateProjection?.blocking ? (
        <RecordingGateMenuOverlay
          gateId={recordingGate.id}
          projection={recordingGateProjection}
          pendingAction={pendingRecordingGateAction}
          busy={recordingGateActionBusy}
          onAction={onRecordingGateAction}
        />
      ) : null}
      <div className="game-control-main" inert={recordingGateProjection?.blocking || undefined}>
        <div className="game-control-preview">
          <LiveFloorView orientation={hasLevels ? "portrait" : "landscape"} />
          {recordingGateProjection?.state === "ready" ? (
            <div className="recording-gate-ready" role="status" aria-live="polite" aria-atomic="true">
              <CheckIcon />
              <span>{recordingGateProjection.title}</span>
            </div>
          ) : null}
          {activeLevelLaunch ? (
            <div className="countdown-overlay loading" aria-live="polite">
              <span className="launch-spinner" aria-hidden="true" />
              <span>{activeLevelLaunch.phase === "stopping" ? "Deteniendo" : "Cargando"}</span>
            </div>
          ) : introActive ? (
            <div className="countdown-overlay narration" aria-live="polite">
              <span>Narración</span>
            </div>
          ) : countdownValue > 0 ? (
            <div className="countdown-overlay countdown-number" aria-live="polite">
              <span>{countdownValue}</span>
            </div>
          ) : paused ? (
            <div className="countdown-overlay paused" aria-live="polite">
              <span>Pausa</span>
            </div>
          ) : null}
        </div>

        <div className="game-control-copy">
          <div className="game-control-heading">
            <span className="micro">{ambient ? "Ambiente activo" : hasLevels ? (levelModeFree ? "Modo libre" : "Reto en curso") : "Juego activo"}</span>
            <h2>{game.label}</h2>
            <p>{phaseLabel}</p>
          </div>
          {!ambient ? (
            <div className="active-game-stats" aria-label="Estado de partida">
              {hasLevels ? (
                <>
                  <div>
                    <span>{timeCaption}</span>
                    <strong>{timeLabel}</strong>
                  </div>
                  <div aria-label={`Intentos: ${attemptCount}.`}>
                    <span>Intentos</span>
                    <strong>{attemptCount}</strong>
                  </div>
                  {lifeMeter.visible ? (
                    <div className="active-life-stat" aria-label={lifeMeterAriaLabel(lifeMeter)}>
                      <span>Vidas</span>
                      <strong><LifeMeter model={lifeMeter} /></strong>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div>
                    <span>{timeCaption}</span>
                    <strong>{timeLabel}</strong>
                  </div>
                  <div>
                    <span>Puntos</span>
                    <strong>{score}</strong>
                  </div>
                  {lifeMeter.visible ? (
                    <div className="active-life-stat" aria-label={lifeMeterAriaLabel(lifeMeter)}>
                      <span>Vidas</span>
                      <strong><LifeMeter model={lifeMeter} /></strong>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {hasLevels && levelModeFree ? (
            <div className="active-free-controls">
              <div className="active-difficulty-row" role="group" aria-label="Dificultad">
                {difficulties.map((candidate) => {
                  const supported = supportedDifficulties.includes(candidate.id);
                  return (
                    <button
                      key={candidate.id}
                      className={`active-difficulty ${difficulty === candidate.id ? "active" : ""}`}
                      style={{ "--difficulty-color": candidate.color, "--difficulty-rgb": hexToRGB(candidate.color) } as CSSProperties}
                      type="button"
                      disabled={!supported || difficultyLocked || busy}
                      aria-pressed={difficulty === candidate.id}
                      onClick={() => {
                        if (supported && !difficultyLocked && !busy) onDifficultyChange(candidate.id);
                      }}
                    >
                      <span>{candidate.label}</span>
                      <StarRating difficulty={candidate.id} label={candidate.label} />
                    </button>
                  );
                })}
              </div>
              {difficultyLocked ? <p className="active-lock-note">Detén el nivel para cambiar dificultad.</p> : null}
              <button className="btn active-next-level" type="button" onClick={onNextLevel} disabled={busy} aria-busy={busy || undefined}>
                {activeLevelLaunch ? (
                  <>
                    <span className="launch-spinner" aria-hidden="true" />
                    Cargando nivel
                  </>
                ) : "Siguiente nivel"}
              </button>
            </div>
          ) : null}
          {!ambient ? <div className="control-roster" data-count={Math.min(players.length, 8)}>
            {players.slice(0, 8).map((player) => (
              <span key={player.id} className="player-pill ph-mask" style={{ "--pc": player.color, "--pc-ink": playerColorInk(player.color) } as CSSProperties}>
                <span />
                <span>{playerLabel(allPlayers, player)}</span>
              </span>
            ))}
          </div> : null}
          {error ? <div className="message error" role="alert">{error}</div> : null}
        </div>
        {hasLevels ? (
          <section className="active-level-rail" aria-label={levelModeFree ? "Elegir nivel" : "Niveles del reto"} role="radiogroup">
            <div className="active-level-rail-heading">
              <span className="micro">{levelModeFree ? "Cambiar nivel" : "Nivel actual"}</span>
              <strong>{levelModeFree ? "Todos los niveles" : progressLabel}</strong>
            </div>
            <div className="active-level-grid">
              {levels.map((level) => renderLevelOption(level, {
                activeLevelID: currentLevelID,
                launchingLevelID: activeLevelLaunch?.levelID || null,
                launchPhase: activeLevelLaunch?.phase || null,
                levelMode,
                selectable: levelModeFree && !busy,
                onSelect: onLevelSelect,
              }))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="game-control-actions" inert={recordingGateProjection?.blocking || undefined}>
        <button className="btn control-action" type="button" onClick={onPauseToggle} disabled={busy} aria-busy={pendingControlAction === "pause" || pendingControlAction === "resume" || undefined}>
          {pendingControlAction === "pause" || pendingControlAction === "resume" ? <span className="launch-spinner" aria-hidden="true" /> : paused ? <PlayIcon /> : <PauseIcon />}
          {pendingControlAction === "pause" || pendingControlAction === "resume" ? "Aplicando" : paused ? "Reanudar" : "Pausar"}
        </button>
        <button className="btn control-action" type="button" onClick={onRestart} disabled={busy}>
          <RestartIcon />
          Reiniciar
        </button>
        {narrationSupported ? (
          <button
            className="btn control-action narration-toggle"
            type="button"
            disabled={busy}
            aria-busy={pendingControlAction === "narration" || undefined}
            onClick={onNarration}
          >
            {pendingControlAction === "narration" ? <span className="launch-spinner" aria-hidden="true" /> : <BoltIcon />}
            {pendingControlAction === "narration" ? "Reproduciendo" : "Repetir narración"}
          </button>
        ) : null}
        <button className="btn control-action danger" type="button" onClick={onExit} disabled={busy}>
          <CloseIcon />
          {exitLabel}
        </button>
      </div>
    </section>
  );
}

function RecordingGateMenuOverlay({
  gateId,
  projection,
  pendingAction,
  busy,
  onAction,
}: {
  gateId: string;
  projection: RecordingGateMenuProjection;
  pendingAction: RecordingGateAction | null;
  busy: boolean;
  onAction: (action: RecordingGateAction, gateId: string) => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const decision = projection.state === "timed_out";

  useEffect(() => {
    if (!decision) return;
    const frame = window.requestAnimationFrame(() => retryRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [decision, gateId]);

  return (
    <div
      className={`recording-gate-menu-overlay state-${projection.state}`}
      role={decision ? "alertdialog" : "status"}
      aria-modal={decision || undefined}
      aria-live={decision ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={!decision || busy || undefined}
      aria-labelledby="recording-gate-menu-title"
      aria-describedby="recording-gate-menu-body"
      onKeyDown={decision ? (event) => trapKioskFocus(event) : undefined}
    >
      <section className="recording-gate-menu-card">
        <div className="recording-gate-menu-symbol" aria-hidden="true">
          {decision ? "!" : <span className="launch-spinner" />}
        </div>
        <div className="recording-gate-menu-copy">
          <span className="micro">Grabación por intento</span>
          <h2 id="recording-gate-menu-title">{projection.title}</h2>
          <p id="recording-gate-menu-body">{projection.body}</p>
        </div>
        {decision ? (
          <div className="recording-gate-menu-actions">
            {projection.actions.map((action) => {
              const pending = pendingAction === action;
              const className = action === "recording_retry"
                ? "btn primary"
                : action === "recording_cancel"
                  ? "btn danger"
                  : "btn";
              return (
                <button
                  key={action}
                  ref={action === "recording_retry" ? retryRef : undefined}
                  className={className}
                  type="button"
                  disabled={busy || Boolean(pendingAction)}
                  aria-busy={pending || undefined}
                  onClick={() => onAction(action, gateId)}
                >
                  {pending ? <span className="launch-spinner" aria-hidden="true" /> : action === "recording_retry" ? <RefreshIcon /> : action === "recording_continue_without" ? <PlayIcon /> : <CloseIcon />}
                  {recordingGateActionLabel(action, pending)}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LifeMeter({ model }: { model: LifeMeterModel }) {
  if (model.unlimited) {
    return <span className="active-life-meter active-life-meter--infinite"><b>∞</b></span>;
  }
  const lostIndexes = new Set(model.lostIndexes);
  return (
    <span className="active-life-meter" style={{ "--life-slots": Math.max(1, model.slots) } as CSSProperties}>
      {Array.from({ length: model.slots }, (_, index) => {
        const filled = index < model.lives;
        const lost = lostIndexes.has(index);
        return (
          <span
            key={index}
            className={`active-life-heart ${filled ? "filled" : "empty"} ${lost ? "lost" : ""}`}
            data-state={filled ? "filled" : "empty"}
            aria-hidden="true"
          >
            ♥
          </span>
        );
      })}
    </span>
  );
}

function lifeMeterAriaLabel(model: LifeMeterModel) {
  if (model.unlimited) return "Vidas ilimitadas";
  return `${model.lives} ${model.lives === 1 ? "vida restante" : "vidas restantes"} de ${model.slots}`;
}

function TouchKeyboard({
  title,
  value,
  placeholder,
  onType,
  onBackspace,
  onClear,
  onDone,
}: {
  title: string;
  value: string;
  placeholder: string;
  onType: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"letters" | "numbers" | "accents">("letters");
  const [shiftActive, setShiftActive] = useState(true);
  const rows = mode === "numbers" ? keyboardNumberRows : mode === "accents" ? keyboardAccentRows : keyboardLetterRows;
  const shifted = mode !== "numbers" && shiftActive;

  function showKey(key: string) {
    return shifted ? key.toLocaleUpperCase("es-ES") : key;
  }

  function pressKey(key: string) {
    onType(showKey(key));
  }

  function setKeyboardMode(nextMode: "letters" | "numbers" | "accents") {
    setMode((current) => (current === nextMode ? "letters" : nextMode));
    if (nextMode === "numbers") setShiftActive(false);
  }

  function pressSpace() {
    if (value && !value.endsWith(" ")) onType(" ");
  }

  function pressBackspace() {
    onBackspace();
  }

  function pressClear() {
    onClear();
  }

  const composeFontSize = Math.max(32, Math.min(62, Math.floor(840 / Math.max(1, value.length))));

  return (
    <KioskDialogLayer className="keyboard-modal-layer" label="Editar nombre" onDismiss={onDone} restoreFocus={false}>
      <section className="touch-keyboard" aria-label="Teclado táctil">
        <div className="kb-title-tab">
          <span aria-hidden="true">●</span>
          {title}
        </div>

        <div className="kb-compose">
          <div className="kb-field ph-mask">
            <div className="kb-value ph-mask" style={{ "--kb-value-size": `${composeFontSize}px` } as CSSProperties}>
              {value ? <span>{value}</span> : <span className="kb-placeholder">{placeholder}</span>}
              <span className="kb-caret" />
            </div>
          </div>
          <button className="kb-done" type="button" onClick={onDone}>
            <CheckIcon />
            Listo
          </button>
        </div>

        <div className="keyboard-rows">
          {rows.map((row, index) => (
            <div className={`keyboard-row ${mode === "accents" ? "accents" : ""} ${index === 2 ? "bottom-letters" : ""}`} key={`${mode}-${row}`}>
              {index === 2 && mode !== "numbers" ? (
                <button className={`key shift ${shiftActive ? "active" : ""}`} type="button" aria-label="Mayúsculas" aria-pressed={shiftActive} onClick={() => setShiftActive((active) => !active)}>
                  ⇧
                </button>
              ) : null}
              {row.split("").map((key) => (
                <button className={`key ${mode === "accents" ? "accent" : ""}`} key={key} type="button" onClick={() => pressKey(key)}>
                  {showKey(key)}
                </button>
              ))}
              {index === 2 ? (
                <button className="key backspace" type="button" aria-label="Borrar carácter" onClick={pressBackspace}>
                  <BackspaceIcon />
                </button>
              ) : null}
            </div>
          ))}
          <div className="keyboard-row keyboard-tools">
            <button className={`key mode ${mode === "numbers" ? "active" : ""}`} type="button" aria-pressed={mode === "numbers"} onClick={() => setKeyboardMode("numbers")}>
              123
            </button>
            <button className={`key mode ${mode === "accents" ? "active" : ""}`} type="button" aria-pressed={mode === "accents"} onClick={() => setKeyboardMode("accents")}>
              Acentos
            </button>
            <button className="key space" type="button" onClick={pressSpace}>
              Espacio
            </button>
            <button className="key clear" type="button" aria-label="Borrar todo" onClick={pressClear} disabled={!value}>
              Borrar todo
            </button>
          </div>
        </div>
      </section>
    </KioskDialogLayer>
  );
}

function PartyPreview({ catalogGames, compact = false, difficulty, game, rich = true }: { catalogGames: GameCard[]; compact?: boolean; difficulty: DifficultyID; game: GameCard; rich?: boolean }) {
  const miniGames = game.partyMiniGames || [];
  const gridSize = partyPreviewGridSize(miniGames.length);
  return (
    <div
      className="preview party-preview"
      style={{ "--party-grid": gridSize, "--party-count": miniGames.length } as CSSProperties}
      aria-hidden="true"
    >
      {miniGames.map((item, index) => {
        const miniGame = catalogGames.find((candidate) => candidate.id === item.gameId || engineGameID(candidate) === item.gameId);
        const previewDifficulty = miniGame
          ? normalizedDifficultyForGame(miniGame, item.difficultyMode === "override" && item.difficulty ? item.difficulty : difficulty)
          : difficulty;
        const levelID = item.level || (miniGame?.levels?.length ? defaultLevelIDForDifficulty(miniGame, previewDifficulty) : "");
        const selectedLevelID = miniGame?.levels?.length ? closestLevelIDForDifficulty(miniGame, levelID, previewDifficulty) : levelID;
        const level = logicalLevelForGame(miniGame, selectedLevelID);
        const previewSrc = miniGame && level ? levelThumbnailSrc(level, miniGame) : miniGame ? gameThumbnailSrc(miniGame) : undefined;
        const previewSrcs = miniGame && level ? levelThumbnailSrcs(level, miniGame) : miniGame ? gameThumbnailSrcs(miniGame) : emptyPreviewSources;
        const richSrc = rich && miniGame ? (level ? levelPreviewSrc(miniGame, level, previewDifficulty) : miniGame.previewSrc) : undefined;
        const richSrcs = rich && miniGame ? (level ? levelPreviewSrcs(miniGame, level, previewDifficulty) : gamePreviewSrcs(miniGame)) : emptyPreviewSources;
        const animationID = miniGame && level ? levelFallbackPreviewAnimationID(miniGame, level) : miniGame ? previewAnimationID(miniGame) : "";
        const color = miniGame?.color || game.color;
        return (
          <div
            key={`${item.gameId}-${item.level || ""}-${index}`}
            className="party-preview-tile"
            style={{ "--c": color, "--crgb": hexToRGB(color) } as CSSProperties}
          >
            <Preview
              src={previewSrc}
              srcs={previewSrcs}
              richSrc={richSrc}
              richSrcs={richSrcs}
              animationID={animationID}
              revisionHash={level?.previewRevisionHash || miniGame?.previewRevisionHash}
              compact={compact}
              promoteAnimation={rich && !(level && levelHasPreviewMedia(level))}
            />
          </div>
        );
      })}
    </div>
  );
}

function LevelMysteryPreview() {
  return (
    <div className="preview compact-preview level-mystery-preview" aria-hidden="true">
      <span className="level-mystery-preview__icon">
        <QuestionIcon />
      </span>
    </div>
  );
}

function Preview({
  animationID,
  compact = false,
  fallbackAnim,
  promoteAnimation = false,
  richSrc,
  richSrcs = emptyPreviewSources,
  src,
  srcs = emptyPreviewSources,
}: {
  animationID: string;
  compact?: boolean;
  fallbackAnim?: FloorAnim;
  promoteAnimation?: boolean;
  revisionHash?: string;
  richSrc?: string;
  richSrcs?: string[];
  src?: string;
  srcs?: string[];
}) {
  const [failedSrcs, setFailedSrcs] = useState<string[]>([]);
  const [loadedPosterSrc, setLoadedPosterSrc] = useState("");
  const [promotedSrc, setPromotedSrc] = useState("");
  const posterCandidates = useMemo(() => uniquePreviewSources([src, ...srcs]), [src, srcs]);
  const richCandidates = useMemo(
    () => richPreviewCandidates(posterCandidates, [richSrc, ...richSrcs]),
    [posterCandidates, richSrc, richSrcs],
  );
  const sourceCandidates = useMemo(() => uniquePreviewSources([...posterCandidates, ...richCandidates]), [posterCandidates, richCandidates]);
  const posterSrc = posterCandidates.find((candidate) => !failedSrcs.includes(candidate));
  const richCandidate = richCandidates.find((candidate) => !failedSrcs.includes(candidate));
  const mediaWasConfigured = sourceCandidates.length > 0;
  const posterReady = Boolean(posterSrc && loadedPosterSrc === posterSrc);

  useEffect(() => {
    setFailedSrcs((failed) => {
      const next = failed.filter((candidate) => sourceCandidates.includes(candidate));
      return next.length === failed.length ? failed : next;
    });
  }, [sourceCandidates]);

  useEffect(() => {
    setLoadedPosterSrc("");
  }, [posterSrc]);

  useEffect(() => {
    setPromotedSrc("");
  }, [posterSrc, richCandidate]);

  useEffect(() => {
    if (!richCandidate || (posterSrc && !posterReady)) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!cancelled) setPromotedSrc(richCandidate);
    };
    image.onerror = () => {
      if (!cancelled) {
        setFailedSrcs((failed) => failed.includes(richCandidate) ? failed : [...failed, richCandidate]);
      }
    };
    image.src = richCandidate;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [posterReady, posterSrc, richCandidate]);

  const anim = fallbackAnim || floorAnimations[animationID];
  const promotedToAnimation = Boolean(promoteAnimation && posterReady && !richCandidate && anim);
  const mediaSrc = promotedToAnimation ? undefined : promotedSrc || posterSrc;
  const logoMedia = isMotionLevelsLogoSrc(mediaSrc);
  const mediaUnavailable = mediaWasConfigured && !mediaSrc;
  const showAnimation = Boolean((promotedToAnimation || !mediaSrc) && anim);
  const showLogoFallback = !mediaSrc && !showAnimation;
  return (
    <div
      className={`preview ${compact ? "compact-preview" : ""} ${logoMedia || showLogoFallback ? "logo-preview" : ""}`}
      style={{
        "--preview-media-width": `${floorPreviewMediaSpec.width}px`,
        "--preview-media-aspect": `${floorPreviewMediaSpec.width} / ${floorPreviewMediaSpec.height}`,
      } as CSSProperties}
      data-media-unavailable={mediaUnavailable || undefined}
    >
      {mediaSrc ? (
        <img
          className={`preview-media ${logoMedia ? "logo-preview-media" : ""}`}
          src={mediaSrc}
          width={logoMedia ? undefined : floorPreviewMediaSpec.width}
          height={logoMedia ? undefined : floorPreviewMediaSpec.height}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
          loading={compact ? "lazy" : "eager"}
          onError={() => setFailedSrcs((failed) => failed.includes(mediaSrc) ? failed : [...failed, mediaSrc])}
          onLoad={() => {
            if (mediaSrc === posterSrc) setLoadedPosterSrc(posterSrc);
          }}
        />
      ) : showAnimation ? (
        <FloorPreview anim={anim} orientation="landscape" />
      ) : (
        <div className="preview-logo-fallback" aria-hidden="true">
          <img src={publicAssetURL("motion-levels-icon.webp")} alt="" />
        </div>
      )}
    </div>
  );
}
