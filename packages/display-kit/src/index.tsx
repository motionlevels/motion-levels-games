import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Frame, FrameCell, GamePlayer, GameSnapshot } from "@motion-levels-games/game-sdk";

export type Tone = "amber" | "blue" | "cyan" | "green" | "magenta" | "pink" | "red" | "yellow" | "neutral";
export type DisplayPlayer = Pick<GamePlayer, "label" | "score" | "color">;
export type RoundSummary = {
  index: number;
  winnerIndex?: number;
  winnerLabel?: string;
  hits?: number;
};

// Player-facing displays are Spanish only. Phase enums stay in English in code
// (they drive logic and class names); this maps them to Spanish for the pill.
const phaseLabels: Record<string, string> = {
  ready: "Listo",
  waiting: "En espera",
  starting: "Preparados",
  running: "En juego",
  paused: "Pausa",
  finished: "Terminado"
};

export function phaseLabel(phase: string): string {
  return phaseLabels[phase] ?? phase;
}

export function GameDisplayShell({
  title,
  phase,
  variant = "default",
  children
}: {
  title: string;
  phase: string;
  variant?: "default" | "versus";
  children?: ReactNode;
}) {
  return (
    <section className={`ml-display-shell ml-tv-display ml-tv-display-${variant}`} aria-label={`Pantalla de ${title}`}>
      <header className="ml-display-header ml-tv-header">
        <div className="ml-tv-brand" aria-hidden="true">
          <span className="ml-tv-brand-mark" />
          <span className="ml-tv-brand-name">
            <b>Motion</b>
            <b>Levels</b>
          </span>
        </div>
        <div className="ml-tv-title">
          <span className="ml-display-label">Juego</span>
          <h1>{title}</h1>
        </div>
        <span className={`ml-status-pill ml-status-${phase}`}>{phaseLabel(phase)}</span>
      </header>
      <div className="ml-display-content">{children}</div>
    </section>
  );
}

export function PlayerReadyOverlay({ snapshot }: { snapshot: GameSnapshot }) {
  if (snapshot.phase !== "waiting" && snapshot.phase !== "starting") {
    return null;
  }

  const readyPlayers = snapshot.readyPlayers ?? 0;
  const requiredPlayers = Math.max(snapshot.requiredPlayers ?? snapshot.playerCount, 1);
  const starting = snapshot.phase === "starting";
  const countdown = Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000));

  return (
    <section
      aria-label={starting ? "El juego está a punto de empezar" : "Esperando jugadores"}
      className={`ml-player-ready-overlay is-${snapshot.phase}`}
    >
      <div className="ml-player-ready-pulse" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span>{starting ? "Todos listos" : "Esperando jugadores"}</span>
      <strong>{starting ? countdown : `${readyPlayers}/${requiredPlayers}`}</strong>
      <b>{starting ? "El juego está a punto de empezar" : "Entra y permanece en la zona iluminada"}</b>
    </section>
  );
}

export function MetricPanel({
  label,
  value,
  tone = "cyan",
  className = ""
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <article className={`ml-metric ml-metric-${tone} ${className}`.trim()}>
      <span className="ml-metric-label">{label}</span>
      <strong className="ml-metric-value">{value}</strong>
    </article>
  );
}

export function HeartMeter({
  lives,
  slots = Math.max(lives, 0)
}: {
  lives: number;
  slots?: number;
}) {
  return (
    <div className="ml-heart-meter" aria-label={`${lives} lives`}>
      {Array.from({ length: slots }, (_, index) => {
        const filled = index < lives;
        return (
          <span
            aria-hidden="true"
            className={`ml-heart ${filled ? "ml-heart-filled" : "ml-heart-empty"}`}
            key={index}
          >
            {filled ? "♥" : "♡"}
          </span>
        );
      })}
    </div>
  );
}

export function MetricRow({
  children,
  columns = 3,
  className = ""
}: {
  children: ReactNode;
  columns?: number;
  className?: string;
}) {
  return (
    <section className={`ml-metric-row ${className}`.trim()} style={{ "--ml-metric-columns": columns } as CSSProperties}>
      {children}
    </section>
  );
}

export function VersusScoreboard({
  left,
  right,
  target,
  centerLabel,
  centerValue,
  centerCaption = "",
  className = ""
}: {
  left: DisplayPlayer;
  right: DisplayPlayer;
  target: number;
  centerLabel: string;
  centerValue: ReactNode;
  centerCaption?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ml-versus-scoreboard ${className}`.trim()} aria-label="Marcador">
      <PlayerScorePanel player={left} side="red" target={target} />
      <article className="ml-versus-center">
        <span>{centerLabel}</span>
        <strong>{centerValue}</strong>
        {centerCaption ? <b>{centerCaption}</b> : null}
      </article>
      <PlayerScorePanel player={right} side="blue" target={target} />
    </section>
  );
}

export function PlayerScorePanel({
  player,
  side,
  target
}: {
  player: DisplayPlayer;
  side: "red" | "blue";
  target: number;
}) {
  const progress = Math.max(0, Math.min(1, player.score / Math.max(target, 1)));

  return (
    <article
      className={`ml-player-score-panel ml-player-score-${side}`}
      style={{
        "--ml-player": player.color,
        "--ml-player-rgb": hexToRgb(player.color),
        "--ml-score-progress": progress
      } as CSSProperties}
    >
      <div className="ml-player-score-head">
        <span>{player.label}</span>
        <b>{player.score}/{target}</b>
      </div>
      <strong>{player.score}</strong>
      <div className="ml-player-score-track" aria-hidden="true">
        <i />
      </div>
    </article>
  );
}

export function RoundStrip({
  rounds,
  totalRounds,
  activeRound,
  activeLabel = "Ronda actual",
  activeCaption = "Punto en curso",
  fallbackLabel = "Pendiente",
  className = ""
}: {
  rounds: RoundSummary[];
  totalRounds?: number;
  activeRound?: number | null;
  activeLabel?: string;
  activeCaption?: string;
  fallbackLabel?: string;
  className?: string;
}) {
  const roundCount = Math.max(rounds.length, totalRounds ?? 0, 1);
  const roundByIndex = new Map(rounds.map((round) => [round.index, round]));
  const allRounds = Array.from({ length: roundCount }, (_, index) => {
    const roundIndex = index + 1;
    return roundByIndex.get(roundIndex) ?? { index: roundIndex, winnerLabel: fallbackLabel, hits: 0 };
  });
  const defaultActiveRound = rounds.length < roundCount ? rounds.length + 1 : null;
  const resolvedActiveRound = activeRound === undefined ? defaultActiveRound : activeRound;
  const focusRound = resolvedActiveRound ?? Math.max(rounds.length, 1);
  const visibleLimit = 12;
  const visibleStart = Math.min(
    Math.max(0, focusRound - Math.ceil(visibleLimit / 2)),
    Math.max(0, roundCount - visibleLimit)
  );
  const visibleRounds = allRounds.slice(visibleStart, visibleStart + visibleLimit);
  const visibleRangeLabel = roundCount > visibleRounds.length
    ? `Rondas ${visibleRounds[0]?.index}-${visibleRounds.at(-1)?.index} de ${roundCount}`
    : "Historial del partido";
  const stripStyle = {
    "--ml-round-count": visibleRounds.length,
    "--ml-round-progress": `${Math.min(1, rounds.length / roundCount) * 100}%`
  } as CSSProperties;

  return (
    <section className={`ml-round-strip ${className}`.trim()} aria-label="Rondas" style={stripStyle}>
      <div className="ml-round-strip-head">
        <div className="ml-round-strip-title">
          <span>Rondas</span>
          <small>{visibleRangeLabel}</small>
        </div>
        <div className="ml-round-strip-count" aria-label={`${rounds.length} de ${roundCount} rondas jugadas`}>
          <strong>{rounds.length}</strong>
          <span>de {roundCount}</span>
        </div>
      </div>
      <div className="ml-round-progress" aria-hidden="true"><i /></div>
      <div className="ml-round-list">
        {visibleRounds.map((round) => {
          const completed = round.winnerIndex === 0 || round.winnerIndex === 1;
          const current = !completed && round.index === resolvedActiveRound;
          const stateClass = round.winnerIndex === 0
            ? "is-red"
            : round.winnerIndex === 1
              ? "is-blue"
              : current
                ? "is-current"
                : "is-pending";
          const hits = round.hits ?? 0;

          return (
            <article className={`ml-round-card ${stateClass}`} key={round.index}>
              <div className="ml-round-card-head">
                <span>R{round.index}</span>
                <i aria-hidden="true" />
              </div>
              <strong>{completed ? (round.winnerLabel || fallbackLabel) : current ? activeLabel : fallbackLabel}</strong>
              {completed ? <b>{hits} {hits === 1 ? "golpe" : "golpes"}</b> : null}
              {current ? <b>{activeCaption}</b> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FramePreviewPanel({
  frame,
  label = "Vista del suelo",
  className = ""
}: {
  frame: Frame | { width: number; height: number; cells: FrameCell[] };
  label?: string;
  className?: string;
}) {
  return (
    <section className={`ml-frame-preview-panel ${className}`.trim()}>
      <span>{label}</span>
      <FloorPreview frame={frame} />
    </section>
  );
}

export function FloorPreview({
  frame,
  interactive = false,
  onTilePress,
  onTileRelease,
  className = ""
}: {
  frame: Frame | { width: number; height: number; cells: FrameCell[] };
  interactive?: boolean;
  onTilePress?: (x: number, y: number) => void;
  onTileRelease?: (x: number, y: number) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastTileRef = useRef<{ x: number; y: number } | null>(null);
  const activeTileTimeoutRef = useRef<number | null>(null);
  const [activeTile, setActiveTile] = useState<{ x: number; y: number } | null>(null);
  const style = {
    "--ml-floor-cols": frame.width,
    "--ml-floor-rows": frame.height
  } as CSSProperties;
  const rootClassName = `ml-floor-preview ${interactive ? "ml-floor-interactive" : ""} ${className}`.trim();
  const clearPointerFocus = useCallback(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && rootRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  }, []);
  const clearActiveTile = useCallback((delayMillis = 0) => {
    if (activeTileTimeoutRef.current !== null) {
      window.clearTimeout(activeTileTimeoutRef.current);
      activeTileTimeoutRef.current = null;
    }

    if (delayMillis <= 0) {
      setActiveTile(null);
      return;
    }

    activeTileTimeoutRef.current = window.setTimeout(() => {
      setActiveTile(null);
      activeTileTimeoutRef.current = null;
    }, delayMillis);
  }, []);
  const tileFromPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const tile = element?.closest<HTMLElement>("[data-tile-x][data-tile-y]");

    if (!tile || !rootRef.current?.contains(tile)) {
      return null;
    }

    return {
      x: Number(tile.dataset.tileX),
      y: Number(tile.dataset.tileY)
    };
  }, []);
  const pressTile = useCallback(
    (tile: { x: number; y: number }) => {
      clearActiveTile();
      onTilePress?.(tile.x, tile.y);
      lastTileRef.current = tile;
      setActiveTile(tile);
    },
    [clearActiveTile, onTilePress]
  );
  const releaseLastTile = useCallback((clearDelayMillis = 120) => {
    const lastTile = lastTileRef.current;
    if (lastTile) {
      onTileRelease?.(lastTile.x, lastTile.y);
      lastTileRef.current = null;
    }

    clearActiveTile(clearDelayMillis);
  }, [clearActiveTile, onTileRelease]);
  useEffect(
    () => () => {
      if (activeTileTimeoutRef.current !== null) {
        window.clearTimeout(activeTileTimeoutRef.current);
      }
    },
    []
  );
  const moveToTile = useCallback(
    (tile: { x: number; y: number } | null) => {
      const lastTile = lastTileRef.current;
      if (!tile || Number.isNaN(tile.x) || Number.isNaN(tile.y)) {
        releaseLastTile(0);
        return;
      }
      if (lastTile && lastTile.x === tile.x && lastTile.y === tile.y) {
        return;
      }

      releaseLastTile(0);
      pressTile(tile);
    },
    [pressTile, releaseLastTile]
  );
  useEffect(() => {
    if (!interactive) {
      return undefined;
    }

    const endActivePointer = () => {
      activePointerIdRef.current = null;
      releaseLastTile(0);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        endActivePointer();
      }
    };

    window.addEventListener("blur", endActivePointer);
    window.addEventListener("pointercancel", endActivePointer);
    window.addEventListener("pointerup", endActivePointer);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", endActivePointer);
      window.removeEventListener("pointercancel", endActivePointer);
      window.removeEventListener("pointerup", endActivePointer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [interactive, releaseLastTile]);
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || event.button !== 0) {
        return;
      }

      event.preventDefault();
      clearPointerFocus();
      activePointerIdRef.current = event.pointerId;
      rootRef.current?.setPointerCapture(event.pointerId);
      moveToTile(tileFromPoint(event.clientX, event.clientY));
    },
    [clearPointerFocus, interactive, moveToTile, tileFromPoint]
  );
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || activePointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      moveToTile(tileFromPoint(event.clientX, event.clientY));
    },
    [interactive, moveToTile, tileFromPoint]
  );
  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || activePointerIdRef.current !== event.pointerId) {
        return;
      }

      activePointerIdRef.current = null;
      releaseLastTile();
      clearPointerFocus();
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }
    },
    [clearPointerFocus, interactive, releaseLastTile]
  );
  const handleLostPointerCapture = useCallback(() => {
    activePointerIdRef.current = null;
    releaseLastTile(0);
    clearPointerFocus();
  }, [clearPointerFocus, releaseLastTile]);

  return (
    <div
      className={rootClassName}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={endPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      ref={rootRef}
      style={style}
      role="grid"
      aria-label="Vista del suelo"
    >
      {frame.cells.map((cell) => {
        const tileStyle = {
          backgroundColor: cell.color,
          gridColumnStart: cell.x + 1,
          gridRowStart: cell.y + 1
        } as CSSProperties;
        const key = `${cell.x}-${cell.y}`;
        const active = activeTile?.x === cell.x && activeTile.y === cell.y;
        const sharedProps = {
          className: `ml-floor-tile ${active ? "ml-floor-tile-active" : ""}`.trim(),
          style: tileStyle,
          "data-tile-x": cell.x,
          "data-tile-y": cell.y,
          "data-color": cell.color,
          "data-active": active ? "true" : undefined
        };

        if (interactive) {
          return (
            <button
              {...sharedProps}
              aria-label={`Baldosa ${cell.x}, ${cell.y}`}
              key={key}
              type="button"
            />
          );
        }

        return <span {...sharedProps} aria-hidden="true" key={key} />;
      })}
    </div>
  );
}

function hexToRgb(color: string): string {
  const hex = color.replace("#", "").trim();
  const normalized = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);

  if (!Number.isFinite(value)) {
    return "255, 255, 255";
  }

  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
