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
const minDisplayPreviewWidth = 420;
const maxDisplayPreviewWidth = 1280;
const minFloorPreviewWidth = 300;
const maxFloorPreviewWidth = 720;

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
  const [displayPreviewWidth, setDisplayPreviewWidth] = useState(760);
  const [floorPreviewWidth, setFloorPreviewWidth] = useState(540);
  const displayPreviewRef = useRef<HTMLDivElement>(null);
  const [displayPreviewScale, setDisplayPreviewScale] = useState(displayPreviewWidth / nativeDisplayWidth);
  const PlayerDisplay = selectedGame.PlayerDisplay;
  const workbenchStyle = {
    "--floor-preview-width": `${floorPreviewWidth}px`,
    "--display-preview-width": `${displayPreviewWidth}px`,
    "--display-preview-scale": displayPreviewScale
  } as CSSProperties;

  useEffect(() => {
    const element = displayPreviewRef.current;
    if (!element) {
      return undefined;
    }

    const update = () => {
      const width = element.clientWidth || displayPreviewWidth;
      const height = element.clientHeight || Math.round(width * (nativeDisplayHeight / nativeDisplayWidth));
      const nextScale = Math.max(0.01, Math.min(width / nativeDisplayWidth, height / nativeDisplayHeight));
      setDisplayPreviewScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [displayPreviewWidth]);

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
      const nextEvents = gameRef.current.press({
        x,
        y,
        pressed: true,
        atMillis: clockRef.current
      });
      refresh(nextEvents);
    },
    [refresh]
  );

  const handleTileRelease = useCallback(
    (x: number, y: number) => {
      const nextEvents = gameRef.current.release({
        x,
        y,
        pressed: false,
        atMillis: clockRef.current
      });
      refresh(nextEvents);
    },
    [refresh]
  );
  const startDisplayResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = displayPreviewWidth;

      function handleMove(moveEvent: PointerEvent) {
        setDisplayPreviewWidth(clamp(startWidth + moveEvent.clientX - startX, minDisplayPreviewWidth, maxDisplayPreviewWidth));
      }

      function handleUp() {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [displayPreviewWidth]
  );
  const startFloorResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = floorPreviewWidth;

      function handleMove(moveEvent: PointerEvent) {
        setFloorPreviewWidth(clamp(startWidth + moveEvent.clientX - startX, minFloorPreviewWidth, maxFloorPreviewWidth));
      }

      function handleUp() {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [floorPreviewWidth]
  );

  return (
    <main className="playground-shell" style={workbenchStyle}>
      <header className="playground-header">
        <div className="playground-title">
          <span className="eyebrow">Motion Levels Games</span>
          <h1>Playground</h1>
        </div>
        <div className="playground-controls">
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
            Seed
            <input
              inputMode="numeric"
              onChange={(event) => setSeed(Number(event.target.value) || 1)}
              value={seed}
            />
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
          <label>
            Floor
            <input
              inputMode="numeric"
              min={minFloorPreviewWidth}
              max={maxFloorPreviewWidth}
              onChange={(event) => setFloorPreviewWidth(clamp(Number(event.target.value) || floorPreviewWidth, minFloorPreviewWidth, maxFloorPreviewWidth))}
              type="number"
              value={floorPreviewWidth}
            />
          </label>
          <label>
            Display
            <input
              inputMode="numeric"
              min={minDisplayPreviewWidth}
              max={maxDisplayPreviewWidth}
              onChange={(event) => setDisplayPreviewWidth(clamp(Number(event.target.value) || displayPreviewWidth, minDisplayPreviewWidth, maxDisplayPreviewWidth))}
              type="number"
              value={displayPreviewWidth}
            />
          </label>
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
        </div>
      </header>

      <section className="playground-grid">
        <article className="panel floor-panel">
          <div className="panel-heading">
            <span>Interactive floor</span>
            <strong>{snapshot.phase}</strong>
          </div>
          <FloorPreview
            className="playground-floor-preview"
            frame={frame}
            interactive
            onTilePress={handleTilePress}
            onTileRelease={handleTileRelease}
          />
          <button
            aria-label="Resize floor preview"
            className="playground-resize-handle floor-resize-handle"
            onPointerDown={startFloorResize}
            type="button"
          />
        </article>

        <article className="display-panel">
          <div className="panel-heading display-panel-heading">
            <span>Player display</span>
            <strong>{nativeDisplayWidth}x{nativeDisplayHeight}</strong>
          </div>
          <div className="display-preview-box" ref={displayPreviewRef}>
            <div className="display-preview-native">
              <PlayerDisplay snapshot={snapshot} frame={frame} />
            </div>
            <button
              aria-label="Resize player display preview"
              className="playground-resize-handle display-resize-handle"
              onPointerDown={startDisplayResize}
              type="button"
            />
          </div>
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
