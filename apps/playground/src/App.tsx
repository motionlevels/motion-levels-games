import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  ArrowUpToLine,
  Bug,
  Check,
  Copy,
  Dices,
  Info,
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
import { FloorPreview } from "@motion-levels-games/display-kit";
import {
  createGameEngine,
  defaultGamePlayerCount,
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
import { captureDisplayElement, capturePlaygroundSurfaces, copyCaptureToClipboard } from "./captureImages.ts";
import motionLevelsLogo from "./assets/motion-levels-icon.webp";
import { nativeDisplayHeight, nativeDisplayWidth } from "./displayConstants.ts";
import { defaultGame, playgroundGames, type PlaygroundGame } from "./gameRegistry.ts";
import { generateGameMediaBundle, type PlaygroundMediaAsset, type PlaygroundMediaOptions } from "./mediaAssets.ts";
import { PhaseIndicator } from "./PhaseIndicator.tsx";
import { installPlaygroundApi, type PlaygroundApi, type PlaygroundCaptureSurface, type PlaygroundPointSpace } from "./playgroundApi.ts";
import { formatElapsedClock } from "./timeFormat.ts";

const playerDisplayMediaWidth = 1280;
const playerDisplayMediaHeight = 720;
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
  const [selectedGameId, setSelectedGameId] = useState(defaultGame.manifest.id);
  const selectedGame = useMemo(
    () => playgroundGames.find((game) => game.manifest.id === selectedGameId) ?? defaultGame,
    [selectedGameId]
  );
  const [seed, setSeed] = useState(DEFAULT_GAME_SEED);
  const [playerCount, setPlayerCount] = useState(defaultGamePlayerCount(defaultGame.manifest));
  const [difficulty, setDifficulty] = useState<GameDifficulty>(() => defaultDifficultyFor(defaultGame));
  const [gameOptions, setGameOptions] = useState<GameConfigOptions>(() => defaultConfigOptionsFor(defaultGame));
  const [paused, setPaused] = useState(false);
  const started = useMemo(
    () => {
      const startedGame = createStartedGame(
        defaultGame,
        DEFAULT_GAME_SEED,
        defaultGamePlayerCount(defaultGame.manifest),
        defaultDifficultyFor(defaultGame),
        defaultConfigOptionsFor(defaultGame)
      );
      const engine = createGameEngine(startedGame.game, {
        fps: DEFAULT_ENGINE_FPS,
        initialEvents: startedGame.events
      });

      return { ...startedGame, engine };
    },
    []
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
  const pausedRef = useRef(paused);
  const snapshotRef = useRef(snapshot);
  const frameRef = useRef(frame);
  const eventsRef = useRef(events);
  const PlayerDisplay = selectedGame.PlayerDisplay;
  const gameConfigVars = selectedGame.manifest.config?.vars ?? [];
  const difficultyChoices = difficultyOptionsFor(selectedGame);
  const playerCountChoices = playerCountOptionsFor(selectedGame);
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
    pausedRef.current = paused;
  }, [paused]);

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

    const isAtLatest = stream.scrollTop <= 1;
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

  const setPausedState = useCallback((nextPaused: boolean) => {
    pausedRef.current = nextPaused;
    setPaused(nextPaused);
  }, []);

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

  const setGameOptionState = useCallback((configVar: GameConfigVar, nextValue: unknown) => {
    const nextOptions = {
      ...gameOptionsRef.current,
      [configVar.key]: normalizeGameConfigValue(configVar, nextValue)
    };
    gameOptionsRef.current = nextOptions;
    setGameOptions(nextOptions);
  }, []);

  const previewFrameFor = useCallback((sourceFrame: Frame = frameRef.current): Frame => sourceFrame, []);

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

  const restart = useCallback(
    (
      nextSeed = seedRef.current,
      nextPlayerCount = playerCountRef.current,
      nextGame = selectedGameRef.current,
      preservePaused = false,
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
      const nextPaused = preservePaused ? pausedRef.current : false;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
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

  const resetGameOptions = useCallback(() => {
    const defaults = defaultConfigOptionsFor(selectedGameRef.current);
    gameOptionsRef.current = defaults;
    setGameOptions(defaults);
    restart(seedRef.current, playerCountRef.current, selectedGameRef.current, true, difficultyRef.current, defaults);
  }, [restart]);

  const selectGame = useCallback(
    (gameId: string) => {
      const nextGame = playgroundGames.find((game) => game.manifest.id === gameId) ?? selectedGame;
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
      setSeed(nextSeed);
      setPlayerCount(nextPlayerCount);
      setDifficulty(nextDifficulty);
      setGameOptions(nextOptions);
      restart(nextSeed, nextPlayerCount, nextGame, false, nextDifficulty, nextOptions);
    },
    [restart, selectedGame]
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
      const tile = pointToPhysicalTile(x, y, space);
      syncEngineState(engineRef.current.press(tile.x, tile.y));
    },
    [syncEngineState]
  );

  const handleTileRelease = useCallback(
    (x: number, y: number, space: PlaygroundPointSpace = "preview") => {
      const tile = pointToPhysicalTile(x, y, space);
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
      fileName,
      frame: displayFrame,
      game,
      snapshot: displaySnapshot
    }: {
      fileName: string;
      frame: Frame;
      game: PlaygroundGame;
      snapshot: GameSnapshot;
    }): Promise<PlaygroundMediaAsset> => {
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
        flushSync(() => {
          root.render(<MediaPlayerDisplay snapshot={displaySnapshot} frame={displayFrame} />);
        });
        await waitForPaint();
        const capture = await captureDisplayElement(host);
        const webp = await downscaleCaptureToWebp(capture.dataUrl, playerDisplayMediaWidth, playerDisplayMediaHeight, 0.9);
        return {
          kind: "playerDisplay",
          width: playerDisplayMediaWidth,
          height: playerDisplayMediaHeight,
          mimeType: "image/webp",
          fileName,
          dataUrl: webp
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

      const currentGameSelected = game.manifest.id === selectedGameRef.current.manifest.id;
      const fallbackOptions = currentGameSelected ? gameOptionsRef.current : defaultConfigOptionsFor(game);
      return generateGameMediaBundle(game, capturePlayerDisplayAsset, {
        difficulty: currentGameSelected ? difficultyRef.current : defaultDifficultyFor(game),
        playerCount: currentGameSelected ? playerCountRef.current : defaultGamePlayerCount(game.manifest),
        seed: currentGameSelected ? seedRef.current : DEFAULT_GAME_SEED,
        ...options,
        options: options.options ?? fallbackOptions
      });
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
      pause: () => setPausedState(true),
      resume: () => setPausedState(false),
      reset: () => restart(
        seedRef.current,
        playerCountRef.current,
        selectedGameRef.current,
        true,
        difficultyRef.current,
        gameOptionsRef.current
      ),
      step: stepGame,
      press: (x, y, options) => handleTilePress(x, y, options?.space ?? "physical"),
      release: (x, y, options) => handleTileRelease(x, y, options?.space ?? "physical"),
      tap: (x, y, options) => {
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
    [captureSurfaces, copySurface, generateMedia, handleTilePress, handleTileRelease, previewFrameFor, restart, setPausedState, stepGame]
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

      setDebugOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDebugOpen(false);
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
  }, [debugOpen]);

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

      setSettingsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
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
  }, [settingsOpen]);

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
  const eventStream = events;
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
  const activeRunSettings = [
    ["Difficulty", difficultyLabels[difficulty] ?? difficulty],
    ["Players", playerCount === 0 ? "Any" : String(playerCount)],
    ["Seed", String(seed)],
    ...gameConfigVars.map((configVar) => [
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
                <label className="control-field control-game">
                  <span>Game</span>
                  <select
                    onChange={(event) => selectGame(event.target.value)}
                    value={selectedGame.manifest.id}
                  >
                    {playgroundGames.map((game) => (
                      <option key={game.manifest.id} value={game.manifest.id}>
                        {game.manifest.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-field control-players">
                  <span>Players</span>
                  <select
                    onChange={(event) => setPlayerCountState(Number(event.target.value))}
                    value={playerCount}
                  >
                    {playerCountChoices.map((count) => (
                      <option key={count} value={count}>
                        {count === 0 ? "0 / Any" : count}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-field control-difficulty">
                  <span>Difficulty</span>
                  <select
                    onChange={(event) => setDifficultyState(event.target.value)}
                    value={difficulty}
                  >
                    {difficultyChoices.map((choice) => (
                      <option key={choice} value={choice}>
                        {difficultyLabels[choice] ?? choice}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="control-group">
                <label className="control-field control-seed">
                  <span>Seed</span>
                  <input
                    inputMode="numeric"
                    max={MAX_GAME_SEED}
                    min={MIN_GAME_SEED}
                    onChange={(event) => setSeedState(normalizeGameSeed(Number(event.target.value)))}
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
                  onClick={() => setSettingsOpen((value) => !value)}
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
                    setSeedState(nextSeed);
                    restart(nextSeed, playerCount, selectedGameRef.current, false, difficulty, gameOptions);
                  }}
                  title="New seed"
                  type="button"
                >
                  <Dices size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label={paused ? "Resume" : "Pause"}
                  aria-pressed={paused}
                  className="icon-button"
                  onClick={() => setPausedState(!pausedRef.current)}
                  title={paused ? "Resume" : "Pause"}
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
                  onClick={() => setDebugOpen((value) => !value)}
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
                          setDebugOpen(false);
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
                        setSettingsOpen(false);
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
              <PlayerDisplay snapshot={snapshot} frame={frame} />
            </div>
          </div>

          <section className="status-dock" aria-label="Playground status">
            <article className="status-card status-card-runtime">
              <div className="status-card-head">
                <span>Runtime</span>
                <PhaseIndicator as="strong" className="runtime-state" phase={displayedPhase} />
              </div>
              <div className="status-runtime-summary">
                <span>Engine clock</span>
                <strong>{formatElapsedClock(engineRef.current.clockMillis)}</strong>
                <small>{frameNumber.toLocaleString()} frames processed</small>
              </div>
              <dl className="status-metrics">
                <div>
                  <dt>Clock</dt>
                  <dd>{formatElapsedClock(engineRef.current.clockMillis)}</dd>
                </div>
                <div>
                  <dt>FPS</dt>
                  <dd>{engineRef.current.fps}</dd>
                </div>
                <div>
                  <dt>Frame</dt>
                  <dd>{frameNumber}</dd>
                </div>
              </dl>
            </article>

            <article className="status-card status-card-event">
              <div className="status-card-head">
                <span>Event stream</span>
                <div className="status-stream-controls">
                  <code aria-label={`${events.length} retained events`}>{events.length}</code>
                  <button
                    aria-label={eventAutoFollow ? "Disable event auto-follow" : "Enable event auto-follow"}
                    aria-pressed={eventAutoFollow}
                    className={`status-stream-follow ${eventAutoFollow ? "is-active" : ""}`}
                    onClick={() => setEventAutoFollowState(!eventAutoFollowRef.current)}
                    title={eventAutoFollow ? "Auto-following newest events" : "Event auto-follow paused"}
                    type="button"
                  >
                    {eventAutoFollow ? <ArrowUpToLine aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <ol
                className="status-event-history"
                aria-label="Live event stream"
                aria-live="polite"
                aria-relevant="additions"
                onScroll={handleEventStreamScroll}
                ref={eventStreamRef}
              >
                {eventStream.length > 0 ? (
                  eventStream.map((event) => (
                    <li key={eventKey(event)}>
                      <time dateTime={`PT${Math.max(0, event.atMillis) / 1000}S`}>
                        {formatElapsedClock(event.atMillis)}
                      </time>
                      <strong>{event.cue}</strong>
                      <span>{event.message}</span>
                    </li>
                  ))
                ) : (
                  <li className="status-event-empty">No events yet</li>
                )}
              </ol>
            </article>

            <article className="status-card status-card-config">
              <div className="status-card-head">
                <span>Active run</span>
                <strong>{selectedGame.manifest.label}</strong>
              </div>
              <dl className="status-run-summary">
                <div>
                  <dt>Score</dt>
                  <dd>{snapshot.score}</dd>
                </div>
                <div>
                  <dt>Targets</dt>
                  <dd>{snapshot.activeTargets}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>{events.length}</dd>
                </div>
              </dl>
              <dl className="status-config-list">
                {activeRunSettings.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          </section>
        </article>

        <article className="panel floor-panel">
          <FloorPreview
            className="playground-floor-preview"
            frame={frame}
            interactive
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

function GameConfigControl({
  configVar,
  onChange,
  value
}: {
  configVar: GameConfigVar;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  if (configVar.type === "bool") {
    return (
      <label className="setting-control setting-control-bool" data-setting-key={configVar.key}>
        <ConfigVarLabel configVar={configVar} />
        <input
          aria-describedby={configDescriptionId(configVar)}
          aria-label={configVar.label}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
    );
  }

  if (configVar.type === "enum") {
    return (
      <label className="setting-control" data-setting-key={configVar.key}>
        <ConfigVarLabel configVar={configVar} />
        <select
          aria-describedby={configDescriptionId(configVar)}
          aria-label={configVar.label}
          onChange={(event) => onChange(event.target.value)}
          value={String(value ?? configVar.default ?? configVar.options?.[0]?.value ?? "")}
        >
          {(configVar.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return <NumberConfigControl configVar={configVar} onChange={onChange} value={value} />;
}

function NumberConfigControl({
  configVar,
  onChange,
  value
}: {
  configVar: GameConfigVar;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const numericValue = Number(value ?? configVar.default ?? configVar.min ?? 0);
  const hasRange = typeof configVar.min === "number" && typeof configVar.max === "number";
  const [draftValue, setDraftValue] = useState(() => formatNumericInput(numericValue));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraftValue(formatNumericInput(numericValue));
    }
  }, [numericValue]);

  const updateDraft = (nextDraft: string) => {
    const normalized = nextDraft.replaceAll(",", ".");
    if (!/^-?\d*(?:\.\d*)?$/.test(normalized)) {
      return;
    }

    setDraftValue(normalized);
    if (normalized !== "" && normalized !== "-" && normalized !== "." && normalized !== "-.") {
      onChange(normalized);
    }
  };

  const finishEditing = () => {
    editingRef.current = false;
    const parsed = Number(draftValue);
    const fallback = typeof configVar.default === "number" ? configVar.default : configVar.min ?? 0;
    const nextValue = normalizeGameConfigValue(configVar, Number.isFinite(parsed) ? parsed : fallback);
    onChange(nextValue);
    setDraftValue(formatNumericInput(Number(nextValue)));
  };

  return (
    <label className="setting-control setting-control-number" data-setting-key={configVar.key}>
      <ConfigVarLabel configVar={configVar} />
      <div className="setting-number-row">
        {hasRange ? (
          <input
            aria-describedby={configDescriptionId(configVar)}
            aria-label={configVar.label}
            max={configVar.max}
            min={configVar.min}
            onChange={(event) => {
              onChange(event.target.value);
              setDraftValue(formatNumericInput(Number(event.target.value)));
            }}
            step={configVar.step ?? (configVar.type === "int" ? 1 : "any")}
            type="range"
            value={String(numericValue)}
          />
        ) : null}
        <input
          aria-describedby={configDescriptionId(configVar)}
          aria-label={configVar.label}
          className="setting-number-input"
          inputMode={configVar.type === "int" ? "numeric" : "decimal"}
          onBlur={finishEditing}
          onChange={(event) => updateDraft(event.target.value)}
          onFocus={() => {
            editingRef.current = true;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          pattern={configVar.type === "int" ? "-?[0-9]*" : "-?[0-9]*[.]?[0-9]*"}
          spellCheck={false}
          type="text"
          value={draftValue}
        />
      </div>
    </label>
  );
}

function ConfigVarLabel({ configVar }: { configVar: GameConfigVar }) {
  return (
    <span className="setting-label">
      <span>{configVar.label}</span>
      {configVar.description ? (
        <span
          aria-describedby={configDescriptionId(configVar)}
          aria-label={`About ${configVar.label}`}
          className="setting-info"
          onClick={(event) => {
            event.preventDefault();
            event.currentTarget.focus();
          }}
          role="img"
          tabIndex={0}
          title={configVar.description}
        >
          <Info aria-hidden="true" size={13} strokeWidth={2.4} />
          <span className="setting-tooltip" id={configDescriptionId(configVar)} role="tooltip">
            {configVar.description}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function configDescriptionId(configVar: GameConfigVar): string | undefined {
  return configVar.description ? `setting-${configVar.key}-description` : undefined;
}

function formatNumericInput(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
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

function playerCountOptionsFor(game: PlaygroundGame): number[] {
  if (game.manifest.players.allowAny) {
    const maxChoice = Math.max(8, game.manifest.players.max);
    return Array.from({ length: maxChoice + 1 }, (_, count) => count);
  }

  const counts = Array.from(
    { length: game.manifest.players.max - game.manifest.players.min + 1 },
    (_, index) => game.manifest.players.min + index
  );
  return counts;
}

function difficultyOptionsFor(game: PlaygroundGame): GameDifficulty[] {
  return gameDifficultyOptions(game.manifest);
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

function eventKey(event: GameEvent): string {
  return `${event.atMillis}:${event.cue}:${event.message}`;
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

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function downscaleCaptureToWebp(
  dataUrl: string,
  width: number,
  height: number,
  quality: number
): Promise<string> {
  const image = await loadDataUrlImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create player display media canvas.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/webp", quality);
}

function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load player display capture."));
    image.src = dataUrl;
  });
}
