import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Bug,
  ArrowLeft,
  Bot,
  BookOpen,
  Check,
  Copy,
  Dices,
  Gamepad2,
  LayoutGrid,
  LoaderCircle,
  Maximize,
  Menu as MenuIcon,
  Minimize,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  TriangleAlert,
  X
} from "lucide-react";
import { animationLibrary, animationMediaURL } from "@motion-levels-games/animation-runtime";
import { FloorPreview, PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import {
  createGameEngine,
  defaultGamePlayerCount,
  gameMediaAssetSpecs,
  gameMediaPreviewStillFrameIndex,
  gamePlayerCountOptions,
  DEFAULT_GAME_SEED,
  DEFAULT_ENGINE_FPS,
  DEFAULT_ENGINE_FRAME_MILLIS,
  DEFAULT_ENGINE_MAX_CATCH_UP_STEPS,
  MAX_GAME_SEED,
  MIN_GAME_SEED,
  gameDifficultyOptions,
  normalizeGameConfigOptions,
  normalizeGameConfigValue,
  normalizeGameDifficulty,
  normalizeGameSeed,
  normalizeFloorRotationDegrees,
  type Frame,
  type GameConfigOptions,
  type GameConfigVar,
  type GameDifficulty,
  type GameEngine,
  type GameEngineState,
  type GameEvent,
  type GameSnapshot
} from "@motion-levels-games/game-sdk";
import {
  captureDisplayElement,
  capturePlaygroundSurfaces,
  copyCaptureToClipboard,
  downscaleCaptureToPng,
  downscaleCaptureToWebp,
  waitForPaint
} from "./captureImages.ts";
import motionLevelsLogo from "./assets/motion-levels-icon.webp";
import { nativeDisplayHeight, nativeDisplayWidth } from "./displayConstants.ts";
import { eventKey, isEventStreamAtLatest } from "./eventStream.ts";
import {
  defaultGame,
  findPlaygroundGame,
  playgroundGames,
  type PlaygroundGame
} from "./gameRegistry.ts";
import {
  JugarAgentSurface,
  type JugarAgentSurfaceController
} from "./JugarAgentSurface.tsx";
import { GameConfigControl } from "./GameConfigControl.tsx";
import {
  generateGameMediaBundle,
  generateAnimationMediaBundle,
  imagesToAnimatedWebpAsset,
  type PlaygroundMediaAsset,
  type PlaygroundMediaOptions,
  type PlayerDisplayMediaFrame
} from "./mediaAssets.ts";
import { playgroundMediaOptionsFor } from "./mediaOptions.ts";
import { PhaseIndicator } from "./PhaseIndicator.tsx";
import { PlayerMenuPreview } from "./PlayerMenuPreview.tsx";
import { PlaygroundStatusDock, type ActiveRunSetting } from "./PlaygroundStatusDock.tsx";
import { PlaygroundSelect } from "./PlaygroundSelect.tsx";
import { isPlaygroundPaused, updatePauseLocks, type PauseLockSet } from "./pausePolicy.ts";
import {
  installPlaygroundApi,
  type AgentLabApi,
  type AgentLabState,
  type PlaygroundApi,
  type PlaygroundCaptureSurface,
  type PlaygroundPointSpace
} from "./playgroundApi.ts";
import { readStoredSelectedGameId, storeSelectedGameId } from "./playgroundPreferences.ts";
import { readPlayerJourneyLaunch } from "./playerJourney.ts";
import { localPlayerMenuUrl, readPlayerMenuLaunchMessage, readPrimaryScreen, type PrimaryScreen } from "./playerMenuEmbed.ts";
import { formatElapsedClock } from "./timeFormat.ts";

const playerDisplayMediaSpec = gameMediaAssetSpecs.playerDisplay;
const playerDisplayAnimationSpec = gameMediaAssetSpecs.playerDisplayAnimation;
const animationMediaBundleRootURL = new URL("../", new URL(import.meta.env.BASE_URL, window.location.href));
const difficultyLabels: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert"
};
function createStartedGame(
  gameModule: PlaygroundGame,
  seed: number,
  playerCount: number,
  difficulty: GameDifficulty,
  options: GameConfigOptions
) {
  const game = gameModule.createGame({
    seed,
    playerCount,
    durationMillis: gameModule.manifest.defaultDurationMillis,
    difficulty,
    options,
    nowMillis: 0
  });
  const events = game.init(0);

  return { game, events };
}

export function App() {
  const floorRotationDegrees = useMemo(
    () => normalizeFloorRotationDegrees(
      typeof window === "undefined" ? 0 : new URLSearchParams(window.location.search).get("floorRotation")
    ),
    []
  );
  const playerJourney = useMemo(() => readPlayerJourneyLaunch(playgroundGames), []);
  const [playerMenuPreviewUrl] = useState(() => localPlayerMenuUrl());
  const initialPrimaryScreen: PrimaryScreen = playerMenuPreviewUrl ? readPrimaryScreen() : "display";
  const initialGame = useMemo(() => {
    if (playerJourney) return findPlaygroundGame(playerJourney.gameId) ?? defaultGame;
    const storedGameId = readStoredSelectedGameId(playgroundGames.map((game) => game.manifest.id));
    return storedGameId ? findPlaygroundGame(storedGameId) ?? defaultGame : defaultGame;
  }, [playerJourney]);
  const [selectedGameId, setSelectedGameId] = useState(initialGame.manifest.id);
  const [primaryScreen, setPrimaryScreen] = useState<PrimaryScreen>(initialPrimaryScreen);
  const selectedGame = useMemo(
    () => findPlaygroundGame(selectedGameId) ?? defaultGame,
    [selectedGameId]
  );
  const [surfaceMode, setSurfaceMode] = useState<"floor" | "agents">("floor");
  const surfaceModeRef = useRef<"floor" | "agents">("floor");
  const agentLabControllerRef = useRef<JugarAgentSurfaceController | null>(null);
  const [agentLabState, setAgentLabState] = useState<AgentLabState | undefined>(undefined);
  const [seed, setSeed] = useState(DEFAULT_GAME_SEED);
  const [playerCount, setPlayerCount] = useState(() => playerJourney?.playerCount ?? defaultGamePlayerCount(initialGame.manifest));
  const [difficulty, setDifficulty] = useState<GameDifficulty>(() => playerJourney?.difficulty ?? defaultDifficultyFor(initialGame));
  const [gameOptions, setGameOptions] = useState<GameConfigOptions>(() => playerJourney?.options ?? defaultConfigOptionsFor(initialGame));
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [pauseLocks, setPauseLocks] = useState<PauseLockSet>(
    () => new Set(initialPrimaryScreen === "menu" ? ["player-menu"] : [])
  );
  const paused = isPlaygroundPaused(manuallyPaused, pauseLocks);
  const agentLabActive = surfaceMode === "agents" && selectedGame.createSessionController !== undefined;
  const started = useMemo(
    () => {
      const startedGame = createStartedGame(
        initialGame,
        DEFAULT_GAME_SEED,
        playerJourney?.playerCount ?? defaultGamePlayerCount(initialGame.manifest),
        playerJourney?.difficulty ?? defaultDifficultyFor(initialGame),
        playerJourney?.options ?? defaultConfigOptionsFor(initialGame)
      );
      const engine = createGameEngine(startedGame.game, {
        fps: DEFAULT_ENGINE_FPS,
        initialEvents: startedGame.events
      });

      return { ...startedGame, engine };
    },
    [initialGame, playerJourney]
  );
  const engineRef = useRef<GameEngine>(started.engine);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(started.engine.state.snapshot);
  const [frame, setFrame] = useState<Frame>(started.engine.state.frame);
  const [events, setEvents] = useState<GameEvent[]>(started.events);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryTab, setLibraryTab] = useState<"all" | "games" | "animations">("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventAutoFollow, setEventAutoFollow] = useState(true);
  const [inputResetSequence, setInputResetSequence] = useState(0);
  const shellRef = useRef<HTMLElement>(null);
  const debugRef = useRef<HTMLElement>(null);
  const debugTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const eventStreamRef = useRef<HTMLOListElement>(null);
  const eventAutoFollowRef = useRef(true);
  const previousLatestEventRef = useRef("");
  const displayPreviewRef = useRef<HTMLDivElement>(null);
  const displayNativeRef = useRef<HTMLDivElement>(null);
  const [displayPreviewScale, setDisplayPreviewScale] = useState(1);
  const selectedGameRef = useRef(selectedGame);
  const seedRef = useRef(seed);
  const playerCountRef = useRef(playerCount);
  const difficultyRef = useRef(difficulty);
  const gameOptionsRef = useRef(gameOptions);
  const manuallyPausedRef = useRef(manuallyPaused);
  const pauseLocksRef = useRef<PauseLockSet>(pauseLocks);
  const pausedRef = useRef(paused);
  const activePlayerInputsRef = useRef(new Map<string, { x: number; y: number }>());
  const snapshotRef = useRef(snapshot);
  const frameRef = useRef(frame);
  const eventsRef = useRef(events);
  const PlayerDisplay = selectedGame.PlayerDisplay;
  const gameConfigVars = selectedGame.manifest.config?.vars ?? [];
  const difficultyChoices = gameDifficultyOptions(selectedGame.manifest);
  const playerCountChoices = gamePlayerCountOptions(selectedGame.manifest);
  const workbenchStyle = {
    "--display-preview-scale": displayPreviewScale
  } as CSSProperties;

  useEffect(() => {
    selectedGameRef.current = selectedGame;
  }, [selectedGame]);

  useEffect(() => {
    surfaceModeRef.current = surfaceMode;
  }, [surfaceMode]);

  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  useEffect(() => {
    playerCountRef.current = playerCount;
  }, [playerCount]);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  useEffect(() => {
    gameOptionsRef.current = gameOptions;
  }, [gameOptions]);

  useEffect(() => {
    manuallyPausedRef.current = manuallyPaused;
    pausedRef.current = isPlaygroundPaused(manuallyPaused, pauseLocksRef.current);
  }, [manuallyPaused]);

  useEffect(() => {
    pauseLocksRef.current = pauseLocks;
    pausedRef.current = isPlaygroundPaused(manuallyPausedRef.current, pauseLocks);
  }, [pauseLocks]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useLayoutEffect(() => {
    const stream = eventStreamRef.current;
    if (!stream) {
      return undefined;
    }

    const previousLatestEvent = previousLatestEventRef.current;
    const currentEventKeys = events.map(eventKey);
    const insertedEventCount = previousLatestEvent ? currentEventKeys.indexOf(previousLatestEvent) : 0;

    if (eventAutoFollowRef.current) {
      stream.scrollTop = 0;
    } else if (insertedEventCount > 0) {
      const rows = Array.from(stream.querySelectorAll<HTMLElement>("li:not(.status-event-empty)"));
      const gap = Number.parseFloat(window.getComputedStyle(stream).rowGap) || 0;
      const insertedHeight = rows
        .slice(0, insertedEventCount)
        .reduce((height, row) => height + row.offsetHeight + gap, 0);
      stream.scrollTop += insertedHeight;
    }

    previousLatestEventRef.current = currentEventKeys[0] ?? "";
    return undefined;
  }, [events]);

  const setEventAutoFollowState = useCallback((nextAutoFollow: boolean) => {
    eventAutoFollowRef.current = nextAutoFollow;
    setEventAutoFollow(nextAutoFollow);
    if (nextAutoFollow && eventStreamRef.current) {
      eventStreamRef.current.scrollTop = 0;
    }
  }, []);

  const handleEventStreamScroll = useCallback(() => {
    const stream = eventStreamRef.current;
    if (!stream) {
      return;
    }

    const isAtLatest = isEventStreamAtLatest(stream.scrollTop);
    if (isAtLatest !== eventAutoFollowRef.current) {
      setEventAutoFollowState(isAtLatest);
    }
  }, [setEventAutoFollowState]);

  useEffect(() => {
    const element = displayPreviewRef.current;
    if (!element) {
      return undefined;
    }

    const update = () => {
      const width = element.clientWidth || nativeDisplayWidth;
      const height = element.clientHeight || Math.round(width * (nativeDisplayHeight / nativeDisplayWidth));
      const nextScale = Math.max(0.01, Math.min(width / nativeDisplayWidth, height / nativeDisplayHeight));
      setDisplayPreviewScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateFullscreen = () => {
      const isFullscreen = document.fullscreenElement === shellRef.current;

      setFullscreen(isFullscreen);
      if (isFullscreen) {
        setFullscreenFallback(false);
      }
    };

    updateFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const syncEngineState = useCallback((state: GameEngineState) => {
    snapshotRef.current = state.snapshot;
    frameRef.current = state.frame;
    setSnapshot(state.snapshot);
    setFrame(state.frame);

    if (state.events.length > 0) {
      const mergedEvents = [...state.events, ...eventsRef.current].slice(0, 50);
      eventsRef.current = mergedEvents;
      setEvents(mergedEvents);
    }
  }, []);

  const releaseActivePlayerInputs = useCallback(() => {
    let nextState: GameEngineState | undefined;
    const emittedEvents: GameEvent[] = [];

    for (const tile of activePlayerInputsRef.current.values()) {
      nextState = engineRef.current.release(tile.x, tile.y);
      emittedEvents.push(...nextState.events);
    }
    activePlayerInputsRef.current.clear();

    if (nextState) {
      syncEngineState({ ...nextState, events: emittedEvents });
    }
  }, [syncEngineState]);

  const setManuallyPausedState = useCallback((nextPaused: boolean) => {
    const nextEffectivePaused = isPlaygroundPaused(nextPaused, pauseLocksRef.current);
    if (!pausedRef.current && nextEffectivePaused) {
      releaseActivePlayerInputs();
    }

    manuallyPausedRef.current = nextPaused;
    pausedRef.current = nextEffectivePaused;
    setManuallyPaused(nextPaused);
  }, [releaseActivePlayerInputs]);

  const setInteractionPauseState = useCallback((lockId: string, active: boolean) => {
    const nextLocks = updatePauseLocks(pauseLocksRef.current, lockId, active);
    if (nextLocks === pauseLocksRef.current) {
      return;
    }

    const nextEffectivePaused = isPlaygroundPaused(manuallyPausedRef.current, nextLocks);
    if (!pausedRef.current && nextEffectivePaused) {
      releaseActivePlayerInputs();
    }

    pauseLocksRef.current = nextLocks;
    pausedRef.current = nextEffectivePaused;
    setPauseLocks(nextLocks);
  }, [releaseActivePlayerInputs]);

  const changePrimaryScreen = useCallback((nextScreen: PrimaryScreen) => {
    if (nextScreen === "menu" && !playerMenuPreviewUrl) return;
    setInteractionPauseState("player-menu", nextScreen === "menu");
    setPrimaryScreen(nextScreen);
  }, [playerMenuPreviewUrl, setInteractionPauseState]);

  const setDebugOpenState = useCallback((open: boolean) => {
    setInteractionPauseState("debug-dialog", open);
    setDebugOpen(open);
  }, [setInteractionPauseState]);

  const setLibraryOpenState = useCallback((open: boolean) => {
    setInteractionPauseState("library-dialog", open);
    setLibraryOpen(open);
    if (!open) setLibraryQuery("");
  }, [setInteractionPauseState]);

  const setSettingsOpenState = useCallback((open: boolean) => {
    setInteractionPauseState("settings-dialog", open);
    setSettingsOpen(open);
  }, [setInteractionPauseState]);

  const setSeedState = useCallback((nextSeed: number) => {
    seedRef.current = nextSeed;
    setSeed(nextSeed);
  }, []);

  const setPlayerCountState = useCallback((nextPlayerCount: number) => {
    playerCountRef.current = nextPlayerCount;
    setPlayerCount(nextPlayerCount);
  }, []);

  const setDifficultyState = useCallback((nextDifficulty: GameDifficulty) => {
    difficultyRef.current = nextDifficulty;
    setDifficulty(nextDifficulty);
  }, []);

  const previewFrameFor = useCallback((sourceFrame: Frame = frameRef.current): Frame => sourceFrame, []);

  const restart = useCallback(
    (
      nextSeed = seedRef.current,
      nextPlayerCount = playerCountRef.current,
      nextGame = selectedGameRef.current,
      nextDifficulty = difficultyRef.current,
      nextOptions = gameOptionsRef.current
    ) => {
      const normalizedOptions = normalizeGameConfigOptions(nextOptions, nextGame.manifest);
      const next = createStartedGame(nextGame, nextSeed, nextPlayerCount, nextDifficulty, normalizedOptions);
      const nextEngine = createGameEngine(next.game, {
        fps: DEFAULT_ENGINE_FPS,
        initialEvents: next.events
      });
      const nextState = nextEngine.state;
      engineRef.current = nextEngine;
      activePlayerInputsRef.current.clear();
      setInputResetSequence((current) => current + 1);
      eventAutoFollowRef.current = true;
      previousLatestEventRef.current = "";
      setEventAutoFollow(true);
      eventsRef.current = next.events;
      snapshotRef.current = nextState.snapshot;
      frameRef.current = nextState.frame;
      difficultyRef.current = nextDifficulty;
      gameOptionsRef.current = normalizedOptions;
      setEvents(next.events);
      setSnapshot(nextState.snapshot);
      setFrame(nextState.frame);
      setDifficulty(nextDifficulty);
      setGameOptions(normalizedOptions);
    },
    []
  );

  const changeSeed = useCallback((nextSeed: number) => {
    if (nextSeed === seedRef.current) {
      return;
    }

    setSeedState(nextSeed);
    restart(nextSeed);
  }, [restart, setSeedState]);

  const changePlayerCount = useCallback((nextPlayerCount: number) => {
    if (nextPlayerCount === playerCountRef.current) {
      return;
    }

    setPlayerCountState(nextPlayerCount);
    restart(seedRef.current, nextPlayerCount);
  }, [restart, setPlayerCountState]);

  const changeDifficulty = useCallback((nextDifficulty: GameDifficulty) => {
    if (nextDifficulty === difficultyRef.current) {
      return;
    }

    setDifficultyState(nextDifficulty);
    restart(seedRef.current, playerCountRef.current, selectedGameRef.current, nextDifficulty);
  }, [restart, setDifficultyState]);

  const setGameOptionState = useCallback((configVar: GameConfigVar, nextValue: unknown) => {
    const normalizedValue = normalizeGameConfigValue(configVar, nextValue);
    if (Object.is(normalizedValue, gameOptionsRef.current[configVar.key])) {
      return;
    }

    const nextOptions = {
      ...gameOptionsRef.current,
      [configVar.key]: normalizedValue
    };
    gameOptionsRef.current = nextOptions;
    setGameOptions(nextOptions);
    restart(
      seedRef.current,
      playerCountRef.current,
      selectedGameRef.current,
      difficultyRef.current,
      nextOptions
    );
  }, [restart]);

  const resetGameOptions = useCallback(() => {
    const defaults = defaultConfigOptionsFor(selectedGameRef.current);
    gameOptionsRef.current = defaults;
    setGameOptions(defaults);
    restart(seedRef.current, playerCountRef.current, selectedGameRef.current, difficultyRef.current, defaults);
  }, [restart]);

  const selectGame = useCallback(
    (
      gameId: string,
      optionOverrides: GameConfigOptions = {},
      selection: { playerCount?: number; difficulty?: string } = {},
    ) => {
      const nextGame = findPlaygroundGame(gameId) ?? defaultGame;
      const nextSeed = DEFAULT_GAME_SEED;
      const playerChoices = gamePlayerCountOptions(nextGame.manifest);
      const nextPlayerCount = selection.playerCount !== undefined && playerChoices.includes(selection.playerCount)
        ? selection.playerCount
        : defaultGamePlayerCount(nextGame.manifest);
      const nextDifficulty = selection.difficulty
        ? normalizeGameDifficulty(selection.difficulty, nextGame.manifest)
        : defaultDifficultyFor(nextGame);
      const nextOptions = normalizeGameConfigOptions({ ...defaultConfigOptionsFor(nextGame), ...optionOverrides }, nextGame.manifest);

      selectedGameRef.current = nextGame;
      seedRef.current = nextSeed;
      playerCountRef.current = nextPlayerCount;
      difficultyRef.current = nextDifficulty;
      gameOptionsRef.current = nextOptions;
      surfaceModeRef.current = "floor";
      agentLabControllerRef.current = null;
      setSelectedGameId(nextGame.manifest.id);
      setSurfaceMode("floor");
      setAgentLabState(undefined);
      storeSelectedGameId(nextGame.manifest.id);
      setSeed(nextSeed);
      setPlayerCount(nextPlayerCount);
      setDifficulty(nextDifficulty);
      setGameOptions(nextOptions);
      restart(nextSeed, nextPlayerCount, nextGame, nextDifficulty, nextOptions);
    },
    [restart]
  );

  useEffect(() => {
    if (!playerMenuPreviewUrl) return undefined;

    const handlePlayerMenuLaunch = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source === window) return;
      const launch = readPlayerMenuLaunchMessage(event.data);
      if (!launch || !findPlaygroundGame(launch.gameId)) return;

      // The menu is an input surface, not a second page. Switch the existing
      // display to the new in-memory session while the floor stays mounted.
      changePrimaryScreen("display");
      selectGame(launch.gameId, launch.options, {
        difficulty: launch.difficulty,
        playerCount: launch.playerCount,
      });
    };

    window.addEventListener("message", handlePlayerMenuLaunch);
    return () => window.removeEventListener("message", handlePlayerMenuLaunch);
  }, [changePrimaryScreen, playerMenuPreviewUrl, selectGame]);

  const selectAnimation = useCallback((animationId: string) => {
    const animationsGame = findPlaygroundGame("animations");
    if (!animationsGame) return;
    selectGame(animationsGame.manifest.id, { animation: animationId, mode: "single" });
    setLibraryOpenState(false);
  }, [selectGame, setLibraryOpenState]);

  const changeSurfaceMode = useCallback((nextMode: "floor" | "agents") => {
    if (nextMode === "agents" && selectedGameRef.current.createSessionController === undefined) {
      return;
    }
    if (nextMode === surfaceModeRef.current) return;
    releaseActivePlayerInputs();
    surfaceModeRef.current = nextMode;
    setSurfaceMode(nextMode);
    if (nextMode === "floor") {
      agentLabControllerRef.current = null;
      setAgentLabState(undefined);
      restart(
        seedRef.current,
        playerCountRef.current,
        selectedGameRef.current,
        difficultyRef.current,
        gameOptionsRef.current
      );
    }
  }, [releaseActivePlayerInputs, restart]);

  useEffect(() => {
    if (paused || agentLabActive) {
      return undefined;
    }

    let frameId = 0;
    let previousRuntimeMillis = performance.now();
    let accumulatedMillis = 0;

    const runFrame = (runtimeMillis: number) => {
      const elapsedMillis = Math.min(
        engineRef.current.frameMillis * DEFAULT_ENGINE_MAX_CATCH_UP_STEPS,
        Math.max(0, runtimeMillis - previousRuntimeMillis)
      );
      previousRuntimeMillis = runtimeMillis;
      accumulatedMillis += elapsedMillis;

      let steps = 0;
      let nextState: GameEngineState | undefined;
      const emittedEvents: GameEvent[] = [];
      const frameMillis = engineRef.current.frameMillis;

      while (accumulatedMillis >= frameMillis && steps < DEFAULT_ENGINE_MAX_CATCH_UP_STEPS) {
        nextState = engineRef.current.step(frameMillis);
        if (nextState.events.length > 0) {
          emittedEvents.push(...nextState.events);
        }
        accumulatedMillis -= frameMillis;
        steps += 1;
      }

      if (steps >= DEFAULT_ENGINE_MAX_CATCH_UP_STEPS && accumulatedMillis >= frameMillis) {
        accumulatedMillis = 0;
      }

      if (nextState) {
        syncEngineState({
          ...nextState,
          events: emittedEvents
        });
      }

      frameId = window.requestAnimationFrame(runFrame);
    };

    frameId = window.requestAnimationFrame(runFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [agentLabActive, paused, syncEngineState]);

  const handleTilePress = useCallback(
    (x: number, y: number, space: PlaygroundPointSpace = "preview") => {
      if (pausedRef.current) {
        return;
      }
      if (surfaceModeRef.current === "agents") {
        return;
      }

      const tile = pointToPhysicalTile(x, y, space);
      activePlayerInputsRef.current.set(`${tile.x}:${tile.y}`, tile);
      syncEngineState(engineRef.current.press(tile.x, tile.y));
    },
    [syncEngineState]
  );

  const handleTileRelease = useCallback(
    (x: number, y: number, space: PlaygroundPointSpace = "preview") => {
      if (pausedRef.current) {
        return;
      }
      if (surfaceModeRef.current === "agents") {
        return;
      }

      const tile = pointToPhysicalTile(x, y, space);
      activePlayerInputsRef.current.delete(`${tile.x}:${tile.y}`);
      syncEngineState(engineRef.current.release(tile.x, tile.y));
    },
    [syncEngineState]
  );

  const captureSurfaces = useCallback(
    async (surfaces?: PlaygroundCaptureSurface[]) => capturePlaygroundSurfaces({
      displayElement: displayNativeRef.current,
      frame: frameRef.current,
      previewFrame: previewFrameFor(),
      surfaces
    }),
    [previewFrameFor]
  );

  const copySurface = useCallback(
    async (surface: PlaygroundCaptureSurface) => {
      const captures = await captureSurfaces([surface]);
      const capture = captures[surface];
      if (!capture) {
        throw new Error(`Could not capture ${surface}.`);
      }

      let copied = false;
      try {
        copied = await copyCaptureToClipboard(capture);
      } catch {
        copied = false;
      }

      return { capture, copied };
    },
    [captureSurfaces]
  );

  const capturePlayerDisplayAsset = useCallback(
    async ({
      animationFileName,
      fileName,
      frames,
      game,
    }: {
      animationFileName: string;
      fileName: string;
      frames: PlayerDisplayMediaFrame[];
      game: PlaygroundGame;
    }): Promise<{ playerDisplay: PlaygroundMediaAsset; playerDisplayAnimation: PlaygroundMediaAsset }> => {
      const host = document.createElement("div");
      host.className = "display-preview-native";
      Object.assign(host.style, {
        height: `${nativeDisplayHeight}px`,
        left: "0",
        pointerEvents: "none",
        position: "fixed",
        top: "0",
        width: `${nativeDisplayWidth}px`,
        zIndex: "2147483647"
      });
      document.body.append(host);
      const root = createRoot(host);
      const MediaPlayerDisplay = game.PlayerDisplay;

      try {
        const animationFrames: Array<{ dataUrl: string; delayMs: number }> = [];
        let stillCapture = "";
        for (const [index, displayFrame] of frames.entries()) {
          flushSync(() => {
            root.render(<MediaPlayerDisplay snapshot={displayFrame.snapshot} frame={displayFrame.frame} />);
          });
          await waitForPaint();
          const capture = await captureDisplayElement(host);
          if (index === Math.min(gameMediaPreviewStillFrameIndex, frames.length - 1)) {
            stillCapture = capture.dataUrl;
          }
          animationFrames.push({
            dataUrl: await downscaleCaptureToPng(
              capture.dataUrl,
              playerDisplayAnimationSpec.width,
              playerDisplayAnimationSpec.height
            ),
            delayMs: displayFrame.delayMs
          });
        }
        if (!stillCapture) {
          throw new Error("Player display media requires at least one preview frame.");
        }
        const webp = await downscaleCaptureToWebp(
          stillCapture,
          playerDisplayMediaSpec.width,
          playerDisplayMediaSpec.height,
          0.9
        );
        return {
          playerDisplay: {
            kind: "playerDisplay",
            width: playerDisplayMediaSpec.width,
            height: playerDisplayMediaSpec.height,
            mimeType: "image/webp",
            fileName,
            dataUrl: webp
          },
          playerDisplayAnimation: await imagesToAnimatedWebpAsset(
            animationFrames,
            animationFileName
          )
        };
      } finally {
        root.unmount();
        host.remove();
      }
    },
    []
  );

  const generateMedia = useCallback(
    async (gameId = selectedGameRef.current.manifest.id, options: PlaygroundMediaOptions = {}) => {
      const game = findPlaygroundGame(gameId);
      if (!game) {
        throw new Error(`Unknown game: ${gameId}`);
      }

      return generateGameMediaBundle(
        game,
        capturePlayerDisplayAsset,
        playgroundMediaOptionsFor(game.manifest.id, {
          gameId: selectedGameRef.current.manifest.id,
          difficulty: difficultyRef.current,
          playerCount: playerCountRef.current,
          seed: seedRef.current,
          options: gameOptionsRef.current
        }, options)
      );
    },
    [capturePlayerDisplayAsset]
  );

  const handleCopySurface = useCallback(
    async (surface: PlaygroundCaptureSurface) => {
      setCaptureMessage(`Capturing ${surface}...`);

      try {
        const { copied } = await copySurface(surface);
        setCaptureMessage(copied ? `Copied ${surface}` : `${surface} ready; clipboard unavailable`);
      } catch (error) {
        setCaptureMessage(error instanceof Error ? error.message : `Could not copy ${surface}`);
      }
    },
    [copySurface]
  );

  const stepGame = useCallback(
    (millis = DEFAULT_ENGINE_FRAME_MILLIS) => {
      if (surfaceModeRef.current === "agents" && agentLabControllerRef.current) {
        const ticks = Math.max(1, Math.round(millis / DEFAULT_ENGINE_FRAME_MILLIS));
        agentLabControllerRef.current.step(ticks);
        return;
      }
      const stepMillis = Number.isFinite(millis) ? Math.max(0, millis) : DEFAULT_ENGINE_FRAME_MILLIS;
      syncEngineState(engineRef.current.step(stepMillis));
    },
    [syncEngineState]
  );

  const handleAgentLabController = useCallback((controller: JugarAgentSurfaceController | null) => {
    agentLabControllerRef.current = controller;
    setAgentLabState(controller?.getState());
  }, []);

  const handleAgentLabFrame = useCallback((nextState: GameEngineState, nextEngine: GameEngine) => {
    engineRef.current = nextEngine;
    syncEngineState(nextState);
    setAgentLabState(agentLabControllerRef.current?.getState());
  }, [syncEngineState]);

  const agentLabApi = useMemo<AgentLabApi>(() => {
    const controller = () => {
      const current = agentLabControllerRef.current;
      if (!current) throw new Error("Agents 3D is not active for the selected game");
      return current;
    };
    return {
      getState: () => {
        const current = agentLabControllerRef.current;
        return current
          ? { ...current.getState(), available: true, active: surfaceModeRef.current === "agents" }
          : inactiveAgentLabState(
            selectedGameRef.current.createSessionController !== undefined,
            surfaceModeRef.current === "agents",
            seedRef.current
          );
      },
      setActive: (active) => changeSurfaceMode(active ? "agents" : "floor"),
      play: () => controller().play(),
      pause: () => controller().pause(),
      step: (ticks) => controller().step(ticks),
      reset: (options) => controller().reset(options),
      setAgentCount: (count) => controller().setAgentCount(count),
      setProfile: (profile) => controller().setProfile(profile),
      setQualityTier: (tier) => controller().setQualityTier(tier),
      setSpeed: (nextSpeed) => controller().setSpeed(nextSpeed),
      selectAgent: (agentId) => controller().selectAgent(agentId),
      setDebug: (options) => controller().setDebug(options),
      startRecording: () => controller().startRecording(),
      stopRecording: () => controller().stopRecording(),
      exportReplay: () => controller().exportReplay(),
      replay: {
        enter: () => controller().replay.enter(),
        exit: () => controller().replay.exit(),
        play: () => controller().replay.play(),
        pause: () => controller().replay.pause(),
        seek: (tick) => controller().replay.seek(tick),
        setSpeed: (nextSpeed) => controller().replay.setSpeed(nextSpeed)
      },
      capture: (options) => controller().capture(options)
    };
  }, [changeSurfaceMode]);

  const api = useMemo<PlaygroundApi>(
    () => ({
      getState: () => ({
        gameId: selectedGameRef.current.manifest.id,
        status: snapshotRef.current.phase,
        paused: pausedRef.current || (
          surfaceModeRef.current === "agents" && (agentLabControllerRef.current?.getState().paused ?? false)
        ),
        rotatedBoard: false,
        snapshot: snapshotRef.current,
        frame: frameRef.current,
        previewFrame: previewFrameFor(),
        events: eventsRef.current,
        clockMillis: engineRef.current.clockMillis,
        fps: engineRef.current.fps,
        frameMillis: engineRef.current.frameMillis,
        difficulty: difficultyRef.current,
        options: gameOptionsRef.current,
        playerCount: playerCountRef.current,
        seed: seedRef.current
      }),
      pause: () => setManuallyPausedState(true),
      resume: () => setManuallyPausedState(false),
      reset: () => {
        if (surfaceModeRef.current === "agents" && agentLabControllerRef.current) {
          agentLabControllerRef.current.reset();
          return;
        }
        restart(
          seedRef.current,
          playerCountRef.current,
          selectedGameRef.current,
          difficultyRef.current,
          gameOptionsRef.current
        );
      },
      step: stepGame,
      press: (x, y, options) => handleTilePress(x, y, options?.space ?? "physical"),
      release: (x, y, options) => handleTileRelease(x, y, options?.space ?? "physical"),
      tap: (x, y, options) => {
        if (pausedRef.current) {
          return;
        }

        handleTilePress(x, y, options?.space ?? "physical");
        stepGame(options?.durationMs ?? DEFAULT_ENGINE_FRAME_MILLIS);
        handleTileRelease(x, y, options?.space ?? "physical");
      },
      capture: captureSurfaces,
      copy: async (surface) => {
        const { capture } = await copySurface(surface);
        return capture;
      },
      media: generateMedia,
      animationMedia: generateAnimationMediaBundle,
      agentLab: agentLabApi
    }),
    [agentLabApi, captureSurfaces, copySurface, generateMedia, handleTilePress, handleTileRelease, previewFrameFor, restart, setManuallyPausedState, stepGame]
  );

  useEffect(() => installPlaygroundApi(api), [api]);

  useEffect(() => {
    if (!captureMessage) {
      return undefined;
    }

    const id = window.setTimeout(() => setCaptureMessage(""), 2600);
    return () => window.clearTimeout(id);
  }, [captureMessage]);

  useEffect(() => {
    if (!debugOpen) {
      return undefined;
    }

    const focusId = window.requestAnimationFrame(() => {
      debugRef.current?.querySelector<HTMLButtonElement>(".popover-close-button")?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      const element = debugRef.current;
      if (!element || element.contains(event.target as Node)) {
        return;
      }

      setDebugOpenState(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDebugOpenState(false);
        window.requestAnimationFrame(() => debugTriggerRef.current?.focus());
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [debugOpen, setDebugOpenState]);

  useEffect(() => {
    if (!libraryOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setLibraryOpenState(false);
      window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [libraryOpen, setLibraryOpenState]);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }

    const focusId = window.requestAnimationFrame(() => {
      settingsRef.current?.querySelector<HTMLButtonElement>(".popover-close-button")?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-settings-trigger]")) {
        return;
      }

      const element = settingsRef.current;
      if (!element || !(target instanceof Node) || element.contains(target)) {
        return;
      }

      setSettingsOpenState(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpenState(false);
        window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen, setSettingsOpenState]);

  const toggleFullscreen = useCallback(async () => {
    const element = shellRef.current;
    if (!element) {
      return;
    }

    if (fullscreenFallback) {
      setFullscreenFallback(false);
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (typeof element.requestFullscreen !== "function") {
        setFullscreenFallback(true);
        return;
      }

      await element.requestFullscreen();
    } catch {
      setFullscreenFallback(true);
      setFullscreen(document.fullscreenElement === element);
    }
  }, [fullscreenFallback]);

  const isFullscreenMode = fullscreen || fullscreenFallback;
  const shellClassName = [
    "playground-shell",
    fullscreenFallback ? "is-fullscreen-fallback" : ""
  ].filter(Boolean).join(" ");
  const latestEvent = events[0];
  const libraryNeedle = libraryQuery.trim().toLocaleLowerCase("es");
  const visibleLibraryGames = playgroundGames.filter((game) => {
    if (game.manifest.slug === "animations") return false;
    const haystack = [game.manifest.label, game.manifest.description, game.manifest.catalog.category, ...(game.manifest.tags ?? [])]
      .join(" ")
      .toLocaleLowerCase("es");
    return !libraryNeedle || haystack.includes(libraryNeedle);
  });
  const visibleLibraryAnimations = animationLibrary.filter((animation) => {
    const haystack = [animation.label, animation.description, animation.category, ...animation.tags]
      .join(" ")
      .toLocaleLowerCase("es");
    return !libraryNeedle || haystack.includes(libraryNeedle);
  });
  const libraryHasVisibleContent = (libraryTab !== "animations" && visibleLibraryGames.length > 0)
    || (libraryTab !== "games" && visibleLibraryAnimations.length > 0);
  const effectivePresentationPaused = paused || (agentLabActive && (agentLabState?.paused ?? false));
  const displayedPhase = effectivePresentationPaused ? "paused" : snapshot.phase;
  const frameMillis = engineRef.current.frameMillis;
  const frameNumber = frameMillis > 0 ? Math.round(engineRef.current.clockMillis / frameMillis) : 0;
  const debugStats: [string, ReactNode][] = [
    ["Game", selectedGame.manifest.label],
    ["Screen", primaryScreen === "menu" ? "Player menu" : "Player display"],
    ["Surface", agentLabActive ? "Jugar 3D" : "Floor"],
    ["Phase", snapshot.phase],
    ["Clock", formatElapsedClock(engineRef.current.clockMillis)],
    ["FPS", engineRef.current.fps],
    ["Seed", seed],
    ["Players", playerCount],
    ["Difficulty", difficulty],
    ["Score", snapshot.score],
    ["Targets", snapshot.activeTargets],
    ["Grid", `${frame.width}x${frame.height}`],
    ["Frame", frameNumber],
    ["API", "ready"]
  ];
  const activeRunSettings: ActiveRunSetting[] = [
    ["Difficulty", difficultyLabels[difficulty] ?? difficulty],
    ["Players", playerCount === 0 ? "Any" : String(playerCount)],
    ["Seed", String(seed)],
    ...gameConfigVars.map((configVar): ActiveRunSetting => [
      configVar.label,
      formatConfigValue(configVar, gameOptions[configVar.key])
    ])
  ];
  const captureToastTone = captureMessage.startsWith("Copied")
    ? "success"
    : captureMessage.startsWith("Capturing")
      ? "pending"
      : "warning";

  return (
    <main
      className={shellClassName}
      ref={shellRef}
      style={workbenchStyle}
    >
      <header className="playground-header">
            <div className="playground-title">
              <div className="playground-title-row">
                <img
                  alt="Motion Levels"
                  className="playground-brand-mark"
                  src={motionLevelsLogo}
                />
                <PhaseIndicator className="phase-chip" phase={displayedPhase} />
              </div>
            </div>
            <div className="playground-controls">
              {playerJourney?.returnUrl ? (
                <button
                  className="journey-return"
                  onClick={() => {
                    if (playerJourney.returnUrl) window.location.assign(playerJourney.returnUrl);
                  }}
                  title="Back to player menu"
                  type="button"
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  <span>Menu</span>
                </button>
              ) : null}
              {!playerMenuPreviewUrl ? (
                <div className="control-group control-group-primary">
                  <PlaygroundSelect
                    className="control-field control-game"
                    label="Game"
                    lockId="game-select"
                    onLockChange={setInteractionPauseState}
                    onValueChange={selectGame}
                    value={selectedGame.manifest.id}
                  >
                    {playgroundGames.map((game) => (
                      <option key={game.manifest.id} value={game.manifest.id}>
                        {game.manifest.label}
                      </option>
                    ))}
                  </PlaygroundSelect>
                  <PlaygroundSelect
                    className="control-field control-players"
                    label="Players"
                    lockId="players-select"
                    onLockChange={setInteractionPauseState}
                    onValueChange={(value) => changePlayerCount(Number(value))}
                    value={playerCount}
                  >
                    {playerCountChoices.map((count) => (
                      <option key={count} value={count}>
                        {count === 0 ? "0 / Any" : count}
                      </option>
                    ))}
                  </PlaygroundSelect>
                  <PlaygroundSelect
                    className="control-field control-difficulty"
                    label="Difficulty"
                    lockId="difficulty-select"
                    onLockChange={setInteractionPauseState}
                    onValueChange={changeDifficulty}
                    value={difficulty}
                  >
                    {difficultyChoices.map((choice) => (
                      <option key={choice} value={choice}>
                        {difficultyLabels[choice] ?? choice}
                      </option>
                    ))}
                  </PlaygroundSelect>
                </div>
              ) : null}
              <div className="control-group">
                <label className="control-field control-seed">
                  <span>Seed</span>
                  <input
                    inputMode="numeric"
                    max={MAX_GAME_SEED}
                    min={MIN_GAME_SEED}
                    onChange={(event) => changeSeed(normalizeGameSeed(Number(event.target.value)))}
                    value={seed}
                  />
                </label>
              </div>
              <div className="control-group control-actions" role="group" aria-label="Game actions">
                <button
                  aria-controls="library-browser"
                  aria-expanded={libraryOpen}
                  aria-haspopup="dialog"
                  aria-label="Browse games and animations"
                  className="icon-button"
                  onClick={() => setLibraryOpenState(!libraryOpen)}
                  ref={libraryTriggerRef}
                  title="Browse library"
                  type="button"
                >
                  <BookOpen size={16} aria-hidden="true" />
                </button>
                <button
                  aria-controls="settings-popover"
                  aria-expanded={settingsOpen}
                  aria-haspopup="dialog"
                  aria-label="Settings"
                  className="icon-button"
                  data-settings-trigger
                  onClick={() => setSettingsOpenState(!settingsOpen)}
                  ref={settingsTriggerRef}
                  title="Settings"
                  type="button"
                >
                  <Settings2 size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label="Restart"
                  className="icon-button"
                  onClick={() => {
                    if (agentLabActive && agentLabControllerRef.current) {
                      agentLabControllerRef.current.reset();
                    } else {
                      restart();
                    }
                  }}
                  title="Restart"
                  type="button"
                >
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label="New seed"
                  className="icon-button"
                  onClick={() => {
                    const nextSeed = randomSeed();
                    changeSeed(nextSeed);
                  }}
                  title="New seed"
                  type="button"
                >
                  <Dices size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label={pauseLocks.size > 0 ? "Paused while controls are open" : manuallyPaused ? "Resume" : "Pause"}
                  aria-pressed={manuallyPaused}
                  className="icon-button"
                  disabled={pauseLocks.size > 0}
                  onClick={() => setManuallyPausedState(!manuallyPausedRef.current)}
                  title={pauseLocks.size > 0 ? "Paused while controls are open" : manuallyPaused ? "Resume" : "Pause"}
                  type="button"
                >
                  {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
                </button>
                <button
                  aria-label={isFullscreenMode ? "Exit fullscreen" : "Fullscreen"}
                  aria-pressed={isFullscreenMode}
                  className="icon-button fullscreen-button"
                  onClick={toggleFullscreen}
                  title={isFullscreenMode ? "Exit fullscreen" : "Fullscreen"}
                  type="button"
                >
                  {isFullscreenMode ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="surface-toolbar" role="group" aria-label="Surface, debug, and capture actions">
              {playerMenuPreviewUrl ? (
                <nav className="surface-mode-toggle primary-screen-toggle" aria-label="Primary screen">
                  <button
                    aria-pressed={primaryScreen === "display"}
                    onClick={() => changePrimaryScreen("display")}
                    title="Player display"
                    type="button"
                  >
                    <Monitor size={14} aria-hidden="true" /> Display
                  </button>
                  <button
                    aria-pressed={primaryScreen === "menu"}
                    onClick={() => changePrimaryScreen("menu")}
                    title="Player menu"
                    type="button"
                  >
                    <MenuIcon size={14} aria-hidden="true" /> Menu
                  </button>
                </nav>
              ) : null}
              <nav className="surface-mode-toggle" aria-label="Simulation surface">
                <button
                  aria-pressed={!agentLabActive}
                  onClick={() => changeSurfaceMode("floor")}
                  title="Interactive floor"
                  type="button"
                >
                  <LayoutGrid size={14} aria-hidden="true" /> Floor
                </button>
                <button
                  aria-pressed={agentLabActive}
                  disabled={selectedGame.createSessionController === undefined}
                  onClick={() => changeSurfaceMode("agents")}
                  title={selectedGame.createSessionController ? "3D agents" : "3D agents are not available for this game yet"}
                  type="button"
                >
                  <Bot size={14} aria-hidden="true" /> Agents 3D
                </button>
              </nav>
              <section className={`debug-panel ${debugOpen ? "is-open" : ""}`} ref={debugRef}>
                <button
                  aria-controls="debug-popover"
                  aria-expanded={debugOpen}
                  aria-haspopup="dialog"
                  aria-label="Debug"
                  className="debug-trigger icon-button"
                  onClick={() => setDebugOpenState(!debugOpen)}
                  ref={debugTriggerRef}
                  title="Debug"
                  type="button"
                >
                  <Bug size={15} aria-hidden="true" />
                </button>

                {debugOpen ? (
                  <div className="debug-popover" id="debug-popover" role="dialog" aria-label="Playground debug panel">
                    <div className="debug-popover-head">
                      <div>
                        <span>Playground</span>
                        <strong>{snapshot.phase}</strong>
                      </div>
                      <PopoverCloseButton
                        label="Close debug panel"
                        onClick={() => {
                          setDebugOpenState(false);
                          window.requestAnimationFrame(() => debugTriggerRef.current?.focus());
                        }}
                      />
                    </div>

                    <dl className="debug-stat-grid">
                      {debugStats.map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd><AnimatedStat value={value} /></dd>
                        </div>
                      ))}
                    </dl>

                    <div className="debug-api-strip">
                      <code>window.ml</code>
                      <code>capture(["display", "boardPreview", "combined"])</code>
                      <code>media("ping-pong")</code>
                    </div>

                    <article className="debug-latest">
                      <span>Latest Event</span>
                      {latestEvent ? (
                        <p>
                          <code>{formatElapsedClock(latestEvent.atMillis)}</code>
                          <b>{latestEvent.cue}</b>
                          <strong>{latestEvent.message}</strong>
                        </p>
                      ) : (
                        <p>No events</p>
                      )}
                    </article>

                    <article className="debug-events">
                      <div className="debug-section-heading">
                        <span>Recent Events</span>
                        <strong>{events.length}</strong>
                      </div>
                      <ol>
                        {events.map((event, index) => (
                          <li key={eventKey(event, index)}>
                            <code>{formatElapsedClock(event.atMillis)}</code>
                            <span>{event.cue}</span>
                            <strong>{event.message}</strong>
                          </li>
                        ))}
                      </ol>
                    </article>

                    <article className="debug-snapshot">
                      <div className="debug-section-heading">
                        <span>Snapshot</span>
                        <strong>{snapshot.score} pts</strong>
                      </div>
                      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
                    </article>
                  </div>
                ) : null}
              </section>
              <div className="capture-actions" aria-label="Capture actions">
                <button
                  aria-label="Copy display"
                  className="icon-button"
                  onClick={() => handleCopySurface("display")}
                  title="Copy display"
                  type="button"
                >
                  <Monitor size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Copy board"
                  className="icon-button"
                  onClick={() => handleCopySurface("boardPreview")}
                  title="Copy board"
                  type="button"
                >
                  <LayoutGrid size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Copy all"
                  className="icon-button"
                  onClick={() => handleCopySurface("combined")}
                  title="Copy all"
                  type="button"
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
            </div>

            {settingsOpen ? (
              <div className="settings-popover" id="settings-popover" ref={settingsRef} role="dialog" aria-label="Game settings">
                <div className="settings-popover-head">
                  <div className="settings-popover-title">
                    <span>Settings</span>
                    <strong>{selectedGame.manifest.label}</strong>
                  </div>
                  <div className="settings-popover-actions">
                    {gameConfigVars.length > 0 ? (
                      <button className="settings-reset" onClick={resetGameOptions} type="button">
                        <RotateCcw size={14} aria-hidden="true" />
                        Reset to defaults
                      </button>
                    ) : null}
                    <PopoverCloseButton
                      label="Close settings"
                      onClick={() => {
                        setSettingsOpenState(false);
                        window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
                      }}
                    />
                  </div>
                </div>

                <div className="settings-list">
                  {gameConfigVars.length > 0 ? (
                    gameConfigVars.map((configVar) => (
                      <GameConfigControl
                        configVar={configVar}
                        key={configVar.key}
                        onChange={(value) => setGameOptionState(configVar, value)}
                        value={gameOptions[configVar.key]}
                      />
                    ))
                  ) : (
                    <p className="settings-empty">This game has no custom settings.</p>
                  )}
                </div>
              </div>
            ) : null}
      </header>

      {libraryOpen ? (
        <div className="library-backdrop">
          <section
            aria-label="Games and animations library"
            className="library-browser"
            id="library-browser"
            role="dialog"
          >
            <header className="library-header">
              <div>
                <span>Local content browser</span>
                <h2>Games &amp; animations</h2>
                <p>Launch every TypeScript experience directly in the development playground.</p>
              </div>
              <PopoverCloseButton
                label="Close content browser"
                onClick={() => {
                  setLibraryOpenState(false);
                  window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
                }}
              />
            </header>
            <div className="library-toolbar">
              <label className="library-search">
                <Search aria-hidden="true" size={18} />
                <span className="sr-only">Search library</span>
                <input
                  autoFocus
                  onChange={(event) => setLibraryQuery(event.currentTarget.value)}
                  placeholder="Search by name, category, or tag…"
                  type="search"
                  value={libraryQuery}
                />
              </label>
              <nav aria-label="Library content type" className="library-tabs">
                {(["all", "games", "animations"] as const).map((tab) => (
                  <button
                    aria-pressed={libraryTab === tab}
                    key={tab}
                    onClick={() => setLibraryTab(tab)}
                    type="button"
                  >
                    {tab === "all" ? "All" : tab === "games" ? "Games" : "Animations"}
                  </button>
                ))}
              </nav>
            </div>
            <div className="library-scroll">
              {libraryTab !== "animations" && visibleLibraryGames.length > 0 ? (
                <section className="library-section">
                  <div className="library-section-title"><Gamepad2 aria-hidden="true" /><h3>Games</h3><span>{visibleLibraryGames.length}</span></div>
                  <div className="library-grid library-game-grid">
                    {visibleLibraryGames.map((game) => (
                      <button
                        className="library-card library-game-card"
                        key={game.manifest.id}
                        onClick={() => {
                          selectGame(game.manifest.id);
                          setLibraryOpenState(false);
                        }}
                        style={{ "--library-accent": game.manifest.catalog.color } as CSSProperties}
                        type="button"
                      >
                        <i className="library-card-glow" />
                        <span className="library-card-type">{game.manifest.catalog.category}</span>
                        <strong>{game.manifest.label}</strong>
                        <p>{game.manifest.description ?? game.manifest.catalog.modeLabel}</p>
                        <small>{game.manifest.players.min}–{game.manifest.players.max} players · {game.manifest.catalog.durationLabel}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {libraryTab !== "games" && visibleLibraryAnimations.length > 0 ? (
                <section className="library-section">
                  <div className="library-section-title"><Sparkles aria-hidden="true" /><h3>Animations</h3><span>{visibleLibraryAnimations.length}</span></div>
                  <div className="library-grid library-animation-grid">
                    {visibleLibraryAnimations.map((animation) => (
                      <button
                        className="library-card library-animation-card"
                        key={animation.id}
                        onClick={() => selectAnimation(animation.id)}
                        style={{ "--library-accent": animation.palette[1] ?? animation.palette[0] } as CSSProperties}
                        type="button"
                      >
                        <span
                          className="library-animation-preview"
                          style={{ background: animation.palette.length > 1 ? `linear-gradient(135deg, ${animation.palette.join(", ")})` : animation.palette[0] }}
                        >
                          <img
                            alt=""
                            decoding="async"
                            loading="lazy"
                            onError={(event) => { event.currentTarget.hidden = true; }}
                            src={animationMediaURL(animation.id, "animation", animationMediaBundleRootURL)}
                          />
                          <i />
                        </span>
                        <span className="library-card-type">{animation.category}</span>
                        <strong>{animation.label}</strong>
                        <p>{animation.description}</p>
                        <span className="library-swatches">{animation.palette.map((color) => <i key={color} style={{ background: color }} />)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {!libraryHasVisibleContent ? (
                <div className="library-empty"><Search aria-hidden="true" /><strong>No content found</strong><span>Try a different name, category, or tag.</span></div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <section className="playground-grid">
        <article className="display-panel">

          <div className="display-preview-box" ref={displayPreviewRef}>
            <div className="display-preview-native" ref={displayNativeRef}>
              <PlayerDisplayRuntimeProvider paused={paused} floorRotationDegrees={floorRotationDegrees}>
                <PlayerDisplay snapshot={snapshot} frame={frame} />
              </PlayerDisplayRuntimeProvider>
            </div>
            {primaryScreen === "menu" && playerMenuPreviewUrl ? (
              <PlayerMenuPreview src={playerMenuPreviewUrl} />
            ) : null}
          </div>

          <PlaygroundStatusDock
            activeRunSettings={activeRunSettings}
            autoFollow={eventAutoFollow}
            clockMillis={engineRef.current.clockMillis}
            eventStreamRef={eventStreamRef}
            events={events}
            fps={engineRef.current.fps}
            frameNumber={frameNumber}
            gameLabel={selectedGame.manifest.label}
            onAutoFollowChange={setEventAutoFollowState}
            onEventStreamScroll={handleEventStreamScroll}
            phase={displayedPhase}
            score={snapshot.score}
            targets={snapshot.activeTargets}
          />
        </article>

        <article className={`panel floor-panel agent-surface-panel ${agentLabActive ? "is-agent-lab" : ""}`}>
          <div className="agent-surface-stage">
            {agentLabActive && selectedGame.createSessionController ? (
              <JugarAgentSurface
                difficulty={difficulty}
                durationMillis={selectedGame.manifest.defaultDurationMillis}
                game={selectedGame}
                gameOptions={gameOptions}
                hostPaused={paused}
                onController={handleAgentLabController}
                onPlayerCountChange={changePlayerCount}
                onState={handleAgentLabFrame}
                onSeedChange={changeSeed}
                playerCount={playerCount}
                seed={seed}
              />
            ) : (
              <FloorPreview
                className="playground-floor-preview"
                frame={frame}
                interactive={!paused}
                inputResetKey={inputResetSequence}
                onTilePress={(x, y) => handleTilePress(x, y, "preview")}
                onTileRelease={(x, y) => handleTileRelease(x, y, "preview")}
              />
            )}
          </div>
        </article>
      </section>
      <div
        aria-atomic="true"
        aria-live="polite"
        className={`capture-toast capture-toast-${captureToastTone} ${captureMessage ? "is-visible" : ""}`.trim()}
        role="status"
      >
        {captureMessage ? (
          <>
            {captureToastTone === "success" ? <Check size={16} aria-hidden="true" /> : null}
            {captureToastTone === "pending" ? <LoaderCircle size={16} aria-hidden="true" /> : null}
            {captureToastTone === "warning" ? <TriangleAlert size={16} aria-hidden="true" /> : null}
            <span>{captureMessage}</span>
          </>
        ) : null}
      </div>
    </main>
  );
}

function PopoverCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="icon-button popover-close-button"
      onClick={onClick}
      title="Close"
      type="button"
    >
      <X aria-hidden="true" size={16} strokeWidth={2.4} />
    </button>
  );
}

function formatConfigValue(configVar: GameConfigVar, value: unknown): string {
  if (configVar.type === "bool") {
    return value === true ? "On" : "Off";
  }

  if (configVar.type === "enum") {
    const option = configVar.options?.find((candidate) => candidate.value === String(value));
    return option?.label ?? option?.value ?? String(value ?? "—");
  }

  return String(value ?? configVar.default ?? "—");
}

function defaultDifficultyFor(game: PlaygroundGame): GameDifficulty {
  return normalizeGameDifficulty(undefined, game.manifest);
}

function defaultConfigOptionsFor(game: PlaygroundGame): GameConfigOptions {
  return normalizeGameConfigOptions({}, game.manifest);
}

function pointToPhysicalTile(x: number, y: number, _space: PlaygroundPointSpace) {
  const point = {
    x: Math.trunc(x),
    y: Math.trunc(y)
  };

  return point;
}

function randomSeed(): number {
  return MIN_GAME_SEED + Math.floor(Math.random() * (MAX_GAME_SEED - MIN_GAME_SEED + 1));
}

function inactiveAgentLabState(available: boolean, active: boolean, seed: number): AgentLabState {
  return {
    available,
    active,
    paused: true,
    replayMode: false,
    replayPaused: true,
    recording: false,
    agentCount: 0,
    profile: "mixed",
    qualityTier: "desktop-medium",
    speed: 1,
    replaySpeed: 1,
    replayEndTick: 0,
    seed,
    tick: 0,
    checksum: "unavailable",
    debug: { paths: false, reservations: false, targets: false }
  };
}

// Re-keys on each value change so the CSS highlight animation replays, giving
// updating debug numbers a subtle live pulse.
function AnimatedStat({ value }: { value: ReactNode }) {
  return (
    <span className="debug-value" key={String(value)}>
      {value}
    </span>
  );
}
