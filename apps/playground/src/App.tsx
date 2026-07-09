import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FloorPreview } from "@motion-levels-games/display-kit";
import {
  createGameEngine,
  DEFAULT_ENGINE_FPS,
  DEFAULT_ENGINE_FRAME_MILLIS,
  DEFAULT_ENGINE_MAX_CATCH_UP_STEPS,
  type Frame,
  type GameEngine,
  type GameEngineState,
  type GameEvent,
  type GameSnapshot
} from "@motion-levels-games/game-sdk";
import { capturePlaygroundSurfaces, copyCaptureToClipboard } from "./captureImages.ts";
import { nativeDisplayHeight, nativeDisplayWidth } from "./displayConstants.ts";
import { defaultGame, playgroundGames, type PlaygroundGame } from "./gameRegistry.ts";
import { rotateFrameClockwise, unrotateFloorPoint, type RenderableFrame } from "./frameTransforms.ts";
import { installPlaygroundApi, type PlaygroundApi, type PlaygroundCaptureSurface, type PlaygroundPointSpace } from "./playgroundApi.ts";

function createStartedGame(gameModule: PlaygroundGame, seed: number, playerCount: number) {
  const game = gameModule.createGame({
    seed,
    playerCount,
    durationMillis: gameModule.manifest.defaultDurationMillis,
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
  const [seed, setSeed] = useState(defaultGame.manifest.defaultSeed);
  const [playerCount, setPlayerCount] = useState(defaultGame.manifest.players.min);
  const [paused, setPaused] = useState(false);
  const started = useMemo(
    () => {
      const startedGame = createStartedGame(defaultGame, defaultGame.manifest.defaultSeed, defaultGame.manifest.players.min);
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
  const [boardFocus, setBoardFocus] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const debugRef = useRef<HTMLElement>(null);
  const displayPreviewRef = useRef<HTMLDivElement>(null);
  const displayNativeRef = useRef<HTMLDivElement>(null);
  const [displayPreviewScale, setDisplayPreviewScale] = useState(1);
  const selectedGameRef = useRef(selectedGame);
  const seedRef = useRef(seed);
  const playerCountRef = useRef(playerCount);
  const pausedRef = useRef(paused);
  const snapshotRef = useRef(snapshot);
  const frameRef = useRef(frame);
  const eventsRef = useRef(events);
  const boardFocusRef = useRef(boardFocus);
  const PlayerDisplay = selectedGame.PlayerDisplay;
  const previewFrame = useMemo(() => boardFocus ? rotateFrameClockwise(frame) : frame, [boardFocus, frame]);
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

  useEffect(() => {
    boardFocusRef.current = boardFocus;
  }, [boardFocus]);

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
  }, [boardFocus]);

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

  const setBoardFocusState = useCallback((nextBoardFocus: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof nextBoardFocus === "function" ? nextBoardFocus(boardFocusRef.current) : nextBoardFocus;
    boardFocusRef.current = resolved;
    setBoardFocus(resolved);
  }, []);

  const previewFrameFor = useCallback((sourceFrame: Frame = frameRef.current): RenderableFrame => {
    return boardFocusRef.current ? rotateFrameClockwise(sourceFrame) : sourceFrame;
  }, []);

  const syncEngineState = useCallback((state: GameEngineState) => {
    snapshotRef.current = state.snapshot;
    frameRef.current = state.frame;
    setSnapshot(state.snapshot);
    setFrame(state.frame);

    if (state.events.length > 0) {
      const mergedEvents = [...state.events, ...eventsRef.current].slice(0, 12);
      eventsRef.current = mergedEvents;
      setEvents(mergedEvents);
    }
  }, []);

  const restart = useCallback(
    (nextSeed = seedRef.current, nextPlayerCount = playerCountRef.current, nextGame = selectedGameRef.current, preservePaused = false) => {
      const next = createStartedGame(nextGame, nextSeed, nextPlayerCount);
      const nextEngine = createGameEngine(next.game, {
        fps: DEFAULT_ENGINE_FPS,
        initialEvents: next.events
      });
      const nextState = nextEngine.state;
      engineRef.current = nextEngine;
      const nextPaused = preservePaused ? pausedRef.current : false;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
      eventsRef.current = next.events;
      snapshotRef.current = nextState.snapshot;
      frameRef.current = nextState.frame;
      setEvents(next.events);
      setSnapshot(nextState.snapshot);
      setFrame(nextState.frame);
    },
    []
  );

  const selectGame = useCallback(
    (gameId: string) => {
      const nextGame = playgroundGames.find((game) => game.manifest.id === gameId) ?? selectedGame;
      const nextSeed = nextGame.manifest.defaultSeed;
      const nextPlayerCount = nextGame.manifest.players.min;

      selectedGameRef.current = nextGame;
      seedRef.current = nextSeed;
      playerCountRef.current = nextPlayerCount;
      setSelectedGameId(nextGame.manifest.id);
      setSeed(nextSeed);
      setPlayerCount(nextPlayerCount);
      restart(nextSeed, nextPlayerCount, nextGame);
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
      const tile = pointToPhysicalTile(x, y, space, boardFocusRef.current, frameRef.current.height);
      syncEngineState(engineRef.current.press(tile.x, tile.y));
    },
    [syncEngineState]
  );

  const handleTileRelease = useCallback(
    (x: number, y: number, space: PlaygroundPointSpace = "preview") => {
      const tile = pointToPhysicalTile(x, y, space, boardFocusRef.current, frameRef.current.height);
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
        rotatedBoard: boardFocusRef.current,
        snapshot: snapshotRef.current,
        frame: frameRef.current,
        previewFrame: previewFrameFor(),
        events: eventsRef.current,
        clockMillis: engineRef.current.clockMillis,
        fps: engineRef.current.fps,
        frameMillis: engineRef.current.frameMillis
      }),
      pause: () => setPausedState(true),
      resume: () => setPausedState(false),
      reset: () => restart(seedRef.current, playerCountRef.current, selectedGameRef.current, true),
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
      }
    }),
    [captureSurfaces, copySurface, handleTilePress, handleTileRelease, previewFrameFor, restart, setPausedState, stepGame]
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

    const handlePointerDown = (event: PointerEvent) => {
      const element = debugRef.current;
      if (!element || element.contains(event.target as Node)) {
        return;
      }

      setDebugOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [debugOpen]);

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
    fullscreenFallback ? "is-fullscreen-fallback" : "",
    boardFocus ? "is-board-focus" : ""
  ].filter(Boolean).join(" ");
  const latestEvent = events[0];
  const debugStats = [
    ["Game", selectedGame.manifest.label],
    ["Phase", snapshot.phase],
    ["Clock", `${formatMillis(engineRef.current.clockMillis)}ms`],
    ["FPS", engineRef.current.fps],
    ["Seed", seed],
    ["Players", playerCount],
    ["Score", snapshot.score],
    ["Targets", snapshot.activeTargets],
    ["Frame", `${frame.width}x${frame.height}`],
    ["Board", boardFocus ? "rotated" : "physical"],
    ["API", "ready"]
  ];

  return (
    <main
      className={shellClassName}
      ref={shellRef}
      style={workbenchStyle}
    >
      <header className="playground-header">
        <div className="playground-title">
          <div className="playground-title-row">
            <h1>Playground</h1>
            <span className={`phase-chip phase-${snapshot.phase}`}>{snapshot.phase}</span>
          </div>
        </div>
        <div className="playground-controls">
          <div className="control-group control-group-primary">
            <label>
              Game
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
            <label>
              Players
              <select
                onChange={(event) => setPlayerCountState(Number(event.target.value))}
                value={playerCount}
              >
                {Array.from(
                  { length: selectedGame.manifest.players.max - selectedGame.manifest.players.min + 1 },
                  (_, index) => selectedGame.manifest.players.min + index
                ).map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="control-group">
            <label>
              Seed
              <input
                inputMode="numeric"
                onChange={(event) => setSeedState(Number(event.target.value) || 1)}
                value={seed}
              />
            </label>
          </div>
          <div className="control-group control-actions">
            <button onClick={() => restart()} type="button">
              Restart
            </button>
            <button
              onClick={() => {
                const nextSeed = seed + 1;
                setSeedState(nextSeed);
                restart(nextSeed, playerCount);
              }}
              type="button"
            >
              New seed
            </button>
            <button onClick={() => setPausedState(!pausedRef.current)} type="button">
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="fullscreen-button" onClick={toggleFullscreen} type="button">
              {isFullscreenMode ? "Exit full" : "Fullscreen"}
            </button>
          </div>
        </div>
      </header>

      <section className="playground-grid">
        <article className="display-panel">
          <div className="surface-toolbar">
            <button className="layout-toggle-button" onClick={() => setBoardFocusState((value) => !value)} type="button">
              {boardFocus ? "Restore layout" : "Rotate board"}
            </button>
            <div className="capture-actions" aria-label="Capture actions">
              <button onClick={() => handleCopySurface("display")} type="button">
                Copy display
              </button>
              <button onClick={() => handleCopySurface("boardPreview")} type="button">
                Copy board
              </button>
              <button onClick={() => handleCopySurface("combined")} type="button">
                Copy all
              </button>
            </div>
            {captureMessage ? <span className="capture-status">{captureMessage}</span> : null}
          </div>
          <div className="display-preview-box" ref={displayPreviewRef}>
            <div className="display-preview-native" ref={displayNativeRef}>
              <PlayerDisplay snapshot={snapshot} frame={frame} />
            </div>
          </div>
        </article>

        <article className="panel floor-panel">
          <FloorPreview
            className="playground-floor-preview"
            frame={previewFrame}
            interactive
            onTilePress={(x, y) => handleTilePress(x, y, "preview")}
            onTileRelease={(x, y) => handleTileRelease(x, y, "preview")}
          />
        </article>

        <section className={`debug-panel ${debugOpen ? "is-open" : ""}`} ref={debugRef}>
          <button
            aria-expanded={debugOpen}
            className="debug-trigger"
            onClick={() => setDebugOpen((value) => !value)}
            type="button"
          >
            Debug
          </button>

          {debugOpen ? (
            <div className="debug-popover" role="dialog" aria-label="Playground debug panel">
              <div className="debug-popover-head">
                <div>
                  <span>Playground</span>
                  <strong>{snapshot.phase}</strong>
                </div>
                <button onClick={() => setDebugOpen(false)} type="button" aria-label="Close debug panel">
                  Close
                </button>
              </div>

              <dl className="debug-stat-grid">
                {debugStats.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="debug-api-strip">
                <code>window.ml</code>
                <code>capture(["display", "boardPreview", "combined"])</code>
              </div>

              <article className="debug-latest">
                <span>Latest Event</span>
                {latestEvent ? (
                  <p>
                    <code>{latestEvent.atMillis}ms</code>
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
                    <li key={`${event.atMillis}-${event.cue}-${index}`}>
                      <code>{event.atMillis}ms</code>
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
      </section>
    </main>
  );
}

function pointToPhysicalTile(
  x: number,
  y: number,
  space: PlaygroundPointSpace,
  rotatedBoard: boolean,
  originalHeight: number
) {
  const point = {
    x: Math.trunc(x),
    y: Math.trunc(y)
  };

  if (space === "preview" && rotatedBoard) {
    return unrotateFloorPoint(point.x, point.y, originalHeight);
  }

  return point;
}

function formatMillis(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
