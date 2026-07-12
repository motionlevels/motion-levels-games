import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Bug,
  Check,
  Copy,
  Dices,
  LayoutGrid,
  LoaderCircle,
  Maximize,
  Minimize,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  TriangleAlert,
  X
} from "lucide-react";
import { FloorPreview, PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import {
  createGameEngine,
  defaultGamePlayerCount,
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
import { defaultGame, playgroundGames, type PlaygroundGame } from "./gameRegistry.ts";
import { GameConfigControl } from "./GameConfigControl.tsx";
import {
  generateGameMediaBundle,
  imagesToAnimatedWebpAsset,
  type PlaygroundMediaAsset,
  type PlaygroundMediaOptions,
  type PlayerDisplayMediaFrame
} from "./mediaAssets.ts";
import { playgroundMediaOptionsFor } from "./mediaOptions.ts";
import { PhaseIndicator } from "./PhaseIndicator.tsx";
import { PlaygroundStatusDock, type ActiveRunSetting } from "./PlaygroundStatusDock.tsx";
import { PlaygroundSelect } from "./PlaygroundSelect.tsx";
import { isPlaygroundPaused, updatePauseLocks, type PauseLockSet } from "./pausePolicy.ts";
import { installPlaygroundApi, type PlaygroundApi, type PlaygroundCaptureSurface, type PlaygroundPointSpace } from "./playgroundApi.ts";
import { readStoredSelectedGameId, storeSelectedGameId } from "./playgroundPreferences.ts";
import { formatElapsedClock } from "./timeFormat.ts";

const playerDisplayMediaWidth = 1280;
const playerDisplayMediaHeight = 720;
const playerDisplayAnimationWidth = 640;
const playerDisplayAnimationHeight = 360;
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
  const initialGame = useMemo(() => {
    const storedGameId = readStoredSelectedGameId(playgroundGames.map((game) => game.manifest.id));
    return playgroundGames.find((game) => game.manifest.id === storedGameId) ?? defaultGame;
  }, []);
  const [selectedGameId, setSelectedGameId] = useState(initialGame.manifest.id);
  const selectedGame = useMemo(
    () => playgroundGames.find((game) => game.manifest.id === selectedGameId) ?? defaultGame,
    [selectedGameId]
  );
  const [seed, setSeed] = useState(DEFAULT_GAME_SEED);
  const [playerCount, setPlayerCount] = useState(defaultGamePlayerCount(initialGame.manifest));
  const [difficulty, setDifficulty] = useState<GameDifficulty>(() => defaultDifficultyFor(initialGame));
  const [gameOptions, setGameOptions] = useState<GameConfigOptions>(() => defaultConfigOptionsFor(initialGame));
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [pauseLocks, setPauseLocks] = useState<PauseLockSet>(() => new Set());
  const paused = isPlaygroundPaused(manuallyPaused, pauseLocks);
  const started = useMemo(
    () => {
      const startedGame = createStartedGame(
        initialGame,
        DEFAULT_GAME_SEED,
        defaultGamePlayerCount(initialGame.manifest),
        defaultDifficultyFor(initialGame),
        defaultConfigOptionsFor(initialGame)
      );
      const engine = createGameEngine(startedGame.game, {
        fps: DEFAULT_ENGINE_FPS,
        initialEvents: startedGame.events
      });

      return { ...startedGame, engine };
    },
    [initialGame]
  );
  const engineRef = useRef<GameEngine>(started.engine);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(started.engine.state.snapshot);
  const [frame, setFrame] = useState<Frame>(started.engine.state.frame);
  const [events, setEvents] = useState<GameEvent[]>(started.events);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventAutoFollow, setEventAutoFollow] = useState(true);
  const [inputResetSequence, setInputResetSequence] = useState(0);
  const shellRef = useRef<HTMLElement>(null);
  const debugRef = useRef<HTMLElement>(null);
  const debugTriggerRef = useRef<HTMLButtonElement>(null);
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

  const setDebugOpenState = useCallback((open: boolean) => {
    setInteractionPauseState("debug-dialog", open);
    setDebugOpen(open);
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
    (gameId: string) => {
      const nextGame = playgroundGames.find((game) => game.manifest.id === gameId) ?? defaultGame;
      const nextSeed = DEFAULT_GAME_SEED;
      const nextPlayerCount = defaultGamePlayerCount(nextGame.manifest);
      const nextDifficulty = defaultDifficultyFor(nextGame);
      const nextOptions = defaultConfigOptionsFor(nextGame);

      selectedGameRef.current = nextGame;
      seedRef.current = nextSeed;
      playerCountRef.current = nextPlayerCount;
      difficultyRef.current = nextDifficulty;
      gameOptionsRef.current = nextOptions;
      setSelectedGameId(nextGame.manifest.id);
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
    if (paused) {
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
  }, [paused, syncEngineState]);

  const handleTilePress = useCallback(
    (x: number, y: number, space: PlaygroundPointSpace = "preview") => {
      if (pausedRef.current) {
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
          if (index === Math.min(4, frames.length - 1)) {
            stillCapture = capture.dataUrl;
          }
          animationFrames.push({
            dataUrl: await downscaleCaptureToPng(
              capture.dataUrl,
              playerDisplayAnimationWidth,
              playerDisplayAnimationHeight
            ),
            delayMs: displayFrame.delayMs
          });
        }
        if (!stillCapture) {
          throw new Error("Player display media requires at least one preview frame.");
        }
        const webp = await downscaleCaptureToWebp(stillCapture, playerDisplayMediaWidth, playerDisplayMediaHeight, 0.9);
        return {
          playerDisplay: {
            kind: "playerDisplay",
            width: playerDisplayMediaWidth,
            height: playerDisplayMediaHeight,
            mimeType: "image/webp",
            fileName,
            dataUrl: webp
          },
          playerDisplayAnimation: await imagesToAnimatedWebpAsset(
            animationFrames,
            animationFileName,
            playerDisplayAnimationWidth,
            playerDisplayAnimationHeight
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
      const game = playgroundGames.find((candidate) => candidate.manifest.id === gameId);
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
      const stepMillis = Number.isFinite(millis) ? Math.max(0, millis) : DEFAULT_ENGINE_FRAME_MILLIS;
      syncEngineState(engineRef.current.step(stepMillis));
    },
    [syncEngineState]
  );

  const api = useMemo<PlaygroundApi>(
    () => ({
      getState: () => ({
        gameId: selectedGameRef.current.manifest.id,
        status: snapshotRef.current.phase,
        paused: pausedRef.current,
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
      reset: () => restart(
        seedRef.current,
        playerCountRef.current,
        selectedGameRef.current,
        difficultyRef.current,
        gameOptionsRef.current
      ),
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
      media: generateMedia
    }),
    [captureSurfaces, copySurface, generateMedia, handleTilePress, handleTileRelease, previewFrameFor, restart, setManuallyPausedState, stepGame]
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
  const displayedPhase = paused ? "paused" : snapshot.phase;
  const frameMillis = engineRef.current.frameMillis;
  const frameNumber = frameMillis > 0 ? Math.round(engineRef.current.clockMillis / frameMillis) : 0;
  const debugStats: [string, ReactNode][] = [
    ["Game", selectedGame.manifest.label],
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
      <section className="playground-grid">
        <article className="display-panel">
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
                  onClick={() => restart()}
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

            <div className="surface-toolbar" role="group" aria-label="Debug and capture actions">
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
                        {events.map((event) => (
                          <li key={eventKey(event)}>
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

          <div className="display-preview-box" ref={displayPreviewRef}>
            <div className="display-preview-native" ref={displayNativeRef}>
              <PlayerDisplayRuntimeProvider paused={paused}>
                <PlayerDisplay snapshot={snapshot} frame={frame} />
              </PlayerDisplayRuntimeProvider>
            </div>
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

        <article className="panel floor-panel">
          <FloorPreview
            className="playground-floor-preview"
            frame={frame}
            interactive={!paused}
            inputResetKey={inputResetSequence}
            onTilePress={(x, y) => handleTilePress(x, y, "preview")}
            onTileRelease={(x, y) => handleTileRelease(x, y, "preview")}
          />
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

// Re-keys on each value change so the CSS highlight animation replays, giving
// updating debug numbers a subtle live pulse.
function AnimatedStat({ value }: { value: ReactNode }) {
  return (
    <span className="debug-value" key={String(value)}>
      {value}
    </span>
  );
}
