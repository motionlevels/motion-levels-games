import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FloorPreview } from "@motion-levels-games/display-kit";
import {
  PlayerDisplay as ExampleCatchDisplay,
  createGame as createExampleCatchGame,
  manifest as exampleCatchManifest
} from "@motion-levels-games/example-catch";
import {
  PlayerDisplay as PingPongDisplay,
  createGame as createPingPongGame,
  manifest as pingPongManifest
} from "@motion-levels-games/ping-pong";
import type { Frame, GameConfig, GameEvent, GameInstance, GameManifest, GameSnapshot } from "@motion-levels-games/game-sdk";

const tickMillis = 100;
const nativeDisplayWidth = 1920;
const nativeDisplayHeight = 1080;

type PlaygroundGame = {
  manifest: GameManifest;
  createGame: (config: GameConfig) => GameInstance;
  PlayerDisplay: React.ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
};

const playgroundGames: PlaygroundGame[] = [
  {
    manifest: pingPongManifest,
    createGame: createPingPongGame,
    PlayerDisplay: PingPongDisplay as React.ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>
  },
  {
    manifest: exampleCatchManifest,
    createGame: createExampleCatchGame,
    PlayerDisplay: ExampleCatchDisplay
  }
];
const defaultGame = playgroundGames[0];

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
    () => createStartedGame(defaultGame, defaultGame.manifest.defaultSeed, defaultGame.manifest.players.min),
    []
  );
  const gameRef = useRef<GameInstance>(started.game);
  const clockRef = useRef(0);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(started.game.snapshot());
  const [frame, setFrame] = useState<Frame>(started.game.render());
  const [events, setEvents] = useState<GameEvent[]>(started.events);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [boardFocus, setBoardFocus] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const displayPreviewRef = useRef<HTMLDivElement>(null);
  const [displayPreviewScale, setDisplayPreviewScale] = useState(1);
  const PlayerDisplay = selectedGame.PlayerDisplay;
  const previewFrame = useMemo(() => boardFocus ? rotateFrameClockwise(frame) : frame, [boardFocus, frame]);
  const workbenchStyle = {
    "--display-preview-scale": displayPreviewScale
  } as CSSProperties;

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

  const refresh = useCallback((nextEvents: GameEvent[] = []) => {
    setSnapshot(gameRef.current.snapshot());
    setFrame(gameRef.current.render());

    if (nextEvents.length > 0) {
      setEvents((previous) => [...nextEvents, ...previous].slice(0, 12));
    }
  }, []);

  const restart = useCallback(
    (nextSeed = seed, nextPlayerCount = playerCount, nextGame = selectedGame) => {
      const next = createStartedGame(nextGame, nextSeed, nextPlayerCount);
      gameRef.current = next.game;
      clockRef.current = 0;
      setPaused(false);
      setEvents(next.events);
      setSnapshot(next.game.snapshot());
      setFrame(next.game.render());
    },
    [playerCount, seed, selectedGame]
  );

  const selectGame = useCallback(
    (gameId: string) => {
      const nextGame = playgroundGames.find((game) => game.manifest.id === gameId) ?? selectedGame;
      const nextSeed = nextGame.manifest.defaultSeed;
      const nextPlayerCount = nextGame.manifest.players.min;

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

    const id = window.setInterval(() => {
      const nextClock = clockRef.current + tickMillis;
      clockRef.current = nextClock;
      const nextEvents = gameRef.current.tick({ atMillis: nextClock });
      refresh(nextEvents);
    }, tickMillis);

    return () => window.clearInterval(id);
  }, [paused, refresh]);

  const handleTilePress = useCallback(
    (x: number, y: number) => {
      const tile = boardFocus ? unrotateFloorPoint(x, y, frame.height) : { x, y };
      const nextEvents = gameRef.current.press({
        x: tile.x,
        y: tile.y,
        pressed: true,
        atMillis: clockRef.current
      });
      refresh(nextEvents);
    },
    [boardFocus, frame.height, refresh]
  );

  const handleTileRelease = useCallback(
    (x: number, y: number) => {
      const tile = boardFocus ? unrotateFloorPoint(x, y, frame.height) : { x, y };
      const nextEvents = gameRef.current.release({
        x: tile.x,
        y: tile.y,
        pressed: false,
        atMillis: clockRef.current
      });
      refresh(nextEvents);
    },
    [boardFocus, frame.height, refresh]
  );
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
                onChange={(event) => setPlayerCount(Number(event.target.value))}
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
                onChange={(event) => setSeed(Number(event.target.value) || 1)}
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
                setSeed(nextSeed);
                restart(nextSeed, playerCount);
              }}
              type="button"
            >
              New seed
            </button>
            <button onClick={() => setPaused((value) => !value)} type="button">
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
          <button className="layout-toggle-button" onClick={() => setBoardFocus((value) => !value)} type="button">
            {boardFocus ? "Restore layout" : "Rotate board"}
          </button>
          <div className="display-preview-box" ref={displayPreviewRef}>
            <div className="display-preview-native">
              <PlayerDisplay snapshot={snapshot} frame={frame} />
            </div>
          </div>
        </article>

        <article className="panel floor-panel">
          <FloorPreview
            className="playground-floor-preview"
            frame={previewFrame}
            interactive
            onTilePress={handleTilePress}
            onTileRelease={handleTileRelease}
          />
        </article>

        <details className="debug-panel">
          <summary>Debug</summary>
          <article className="panel log-panel">
          <div className="panel-heading">
            <span>Event log</span>
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

          <article className="panel snapshot-panel">
          <div className="panel-heading">
            <span>Snapshot JSON</span>
            <strong>{snapshot.score} pts</strong>
          </div>
          <pre>{JSON.stringify(snapshot, null, 2)}</pre>
          </article>
        </details>
      </section>
    </main>
  );
}

function rotateFrameClockwise(frame: Frame) {
  return {
    width: frame.height,
    height: frame.width,
    cells: frame.cells.map((cell) => ({
      x: frame.height - 1 - cell.y,
      y: cell.x,
      color: cell.color
    }))
  };
}

function unrotateFloorPoint(x: number, y: number, originalHeight: number) {
  return {
    x: y,
    y: originalHeight - 1 - x
  };
}
