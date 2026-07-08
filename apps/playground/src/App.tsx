import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloorPreview } from "@motion-levels-games/display-kit";
import { createGame, manifest, PlayerDisplay } from "@motion-levels-games/example-catch";
import type { Frame, GameEvent, GameInstance, GameSnapshot } from "@motion-levels-games/game-sdk";

const tickMillis = 100;

function createStartedGame(seed: number, playerCount: number) {
  const game = createGame({
    seed,
    playerCount,
    durationMillis: manifest.defaultDurationMillis,
    nowMillis: 0
  });
  const events = game.init(0);

  return { game, events };
}

export function App() {
  const [seed, setSeed] = useState(manifest.defaultSeed);
  const [playerCount, setPlayerCount] = useState(1);
  const [paused, setPaused] = useState(false);
  const started = useMemo(() => createStartedGame(seed, playerCount), []);
  const gameRef = useRef<GameInstance>(started.game);
  const [clockMillis, setClockMillis] = useState(0);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(started.game.snapshot());
  const [frame, setFrame] = useState<Frame>(started.game.render());
  const [events, setEvents] = useState<GameEvent[]>(started.events);

  const refresh = useCallback((nextEvents: GameEvent[] = []) => {
    setSnapshot(gameRef.current.snapshot());
    setFrame(gameRef.current.render());

    if (nextEvents.length > 0) {
      setEvents((previous) => [...nextEvents, ...previous].slice(0, 12));
    }
  }, []);

  const restart = useCallback(
    (nextSeed = seed, nextPlayerCount = playerCount) => {
      const next = createStartedGame(nextSeed, nextPlayerCount);
      gameRef.current = next.game;
      setClockMillis(0);
      setPaused(false);
      setEvents(next.events);
      setSnapshot(next.game.snapshot());
      setFrame(next.game.render());
    },
    [playerCount, seed]
  );

  useEffect(() => {
    if (paused || snapshot.phase === "finished") {
      return undefined;
    }

    const id = window.setInterval(() => {
      setClockMillis((previous) => {
        const nextClock = previous + tickMillis;
        const nextEvents = gameRef.current.tick({ atMillis: nextClock });
        refresh(nextEvents);
        return nextClock;
      });
    }, tickMillis);

    return () => window.clearInterval(id);
  }, [paused, refresh, snapshot.phase]);

  const handleTilePress = useCallback(
    (x: number, y: number) => {
      const nextEvents = gameRef.current.press({
        x,
        y,
        pressed: true,
        atMillis: clockMillis
      });
      refresh(nextEvents);
    },
    [clockMillis, refresh]
  );

  return (
    <main className="playground-shell">
      <header className="playground-header">
        <div>
          <span className="eyebrow">Motion Levels Games</span>
          <h1>TypeScript Playground</h1>
        </div>
        <div className="playground-controls">
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
              {Array.from({ length: manifest.players.max }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
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
          <FloorPreview frame={frame} interactive onTilePress={handleTilePress} />
        </article>

        <article className="display-panel">
          <PlayerDisplay snapshot={snapshot} frame={frame} />
        </article>

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
      </section>
    </main>
  );
}
