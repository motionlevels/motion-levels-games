import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Frame, FrameCell } from "@motion-levels-games/game-sdk";

export type Tone = "cyan" | "pink" | "yellow" | "green" | "neutral";

export function GameDisplayShell({
  title,
  phase,
  children
}: {
  title: string;
  phase: string;
  children?: ReactNode;
}) {
  return (
    <section className="ml-display-shell">
      <header className="ml-display-header">
        <span className="ml-display-label">Game</span>
        <h1>{title}</h1>
        <span className="ml-status-pill">{phase}</span>
      </header>
      <div className="ml-display-content">{children}</div>
    </section>
  );
}

export function MetricPanel({
  label,
  value,
  tone = "cyan"
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  return (
    <article className={`ml-metric ml-metric-${tone}`}>
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
      activePointerIdRef.current = event.pointerId;
      rootRef.current?.setPointerCapture(event.pointerId);
      moveToTile(tileFromPoint(event.clientX, event.clientY));
    },
    [interactive, moveToTile, tileFromPoint]
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
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }
    },
    [interactive, releaseLastTile]
  );
  const handleLostPointerCapture = useCallback(() => {
    activePointerIdRef.current = null;
    releaseLastTile(0);
  }, [releaseLastTile]);

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
      aria-label="Floor preview"
    >
      {frame.cells.map((cell) => {
        const tileStyle = { backgroundColor: cell.color } as CSSProperties;
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
              aria-label={`Tile ${cell.x}, ${cell.y}`}
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
