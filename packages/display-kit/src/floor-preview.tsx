import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FrameCell } from "@motion-levels-games/game-sdk";
import {
  FloorInputPainter,
  floorTileFromClientPoint,
  type FloorInputAction,
  type FloorInputTile
} from "./floor-input-painter.ts";

export type FloorPreviewCell = FrameCell & { pressed?: boolean };
export type FloorPreviewFrame = { width: number; height: number; cells: FloorPreviewCell[] };
export type FloorPreviewProps = {
  ariaLabel?: string;
  className?: string;
  frame: FloorPreviewFrame;
  inputResetKey?: string | number;
  interactive?: boolean;
  onTilePress?: (x: number, y: number) => void;
  onTileRelease?: (x: number, y: number) => void;
};

export function floorTileAfterKeyboardNavigation(
  tile: FloorInputTile,
  key: string,
  columns: number,
  rows: number
): FloorInputTile | null {
  if (columns < 1 || rows < 1) return null;
  if (key === "ArrowLeft") return { x: Math.max(0, tile.x - 1), y: tile.y };
  if (key === "ArrowRight") return { x: Math.min(columns - 1, tile.x + 1), y: tile.y };
  if (key === "ArrowUp") return { x: tile.x, y: Math.max(0, tile.y - 1) };
  if (key === "ArrowDown") return { x: tile.x, y: Math.min(rows - 1, tile.y + 1) };
  if (key === "Home") return { x: 0, y: tile.y };
  if (key === "End") return { x: columns - 1, y: tile.y };
  return null;
}

export function FramePreviewPanel({
  frame,
  label = "Vista del suelo",
  className = ""
}: {
  frame: FloorPreviewFrame;
  label?: string;
  className?: string;
}) {
  return (
    <section className={`ml-frame-preview-panel ${className}`.trim()}>
      <span>{label}</span>
      <FloorPreview ariaLabel={label} frame={frame} />
    </section>
  );
}

export function FloorPreview({
  ariaLabel = "Vista del suelo",
  frame,
  interactive = false,
  inputResetKey,
  onTilePress,
  onTileRelease,
  className = ""
}: FloorPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const inputPainterRef = useRef(new FloorInputPainter());
  const previousInputResetKeyRef = useRef(inputResetKey);
  const [occupiedTileKeys, setOccupiedTileKeys] = useState(() => new Set<string>());
  const [keyboardTileKey, setKeyboardTileKey] = useState("");
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
  const tileFromPoint = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) {
      return null;
    }

    return floorTileFromClientPoint(clientX, clientY, root.getBoundingClientRect(), frame.width, frame.height);
  }, [frame.height, frame.width]);
  const applyInputActions = useCallback((actions: FloorInputAction[]) => {
    if (actions.length === 0) {
      return;
    }

    for (const action of actions) {
      if (action.pressed) {
        onTilePress?.(action.x, action.y);
      } else {
        onTileRelease?.(action.x, action.y);
      }
    }
    setOccupiedTileKeys(new Set(inputPainterRef.current.keys()));
  }, [onTilePress, onTileRelease]);
  const beginInputGesture = useCallback((tile: FloorInputTile | null) => {
    if (!tile || Number.isNaN(tile.x) || Number.isNaN(tile.y)) {
      return;
    }

    applyInputActions(inputPainterRef.current.begin(tile));
  }, [applyInputActions]);
  const continueInputGesture = useCallback((tile: FloorInputTile | null) => {
    if (!tile || Number.isNaN(tile.x) || Number.isNaN(tile.y)) {
      return;
    }

    applyInputActions(inputPainterRef.current.move(tile));
  }, [applyInputActions]);
  const clearInputPainter = useCallback(() => {
    inputPainterRef.current.reset();
    setOccupiedTileKeys(new Set());
  }, []);
  useEffect(() => {
    if (Object.is(previousInputResetKeyRef.current, inputResetKey)) {
      return;
    }

    previousInputResetKeyRef.current = inputResetKey;
    clearInputPainter();
  }, [clearInputPainter, inputResetKey]);
  useEffect(() => {
    if (!interactive) {
      clearInputPainter();
    }
  }, [clearInputPainter, interactive]);
  useEffect(() => {
    if (!interactive) {
      return undefined;
    }

    const endActivePointer = () => {
      activePointerIdRef.current = null;
      inputPainterRef.current.end();
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
  }, [interactive]);
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || event.button !== 0) {
        return;
      }

      event.preventDefault();
      clearPointerFocus();
      activePointerIdRef.current = event.pointerId;
      rootRef.current?.setPointerCapture(event.pointerId);
      beginInputGesture(tileFromPoint(event.clientX, event.clientY));
    },
    [beginInputGesture, clearPointerFocus, interactive, tileFromPoint]
  );
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || activePointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      continueInputGesture(tileFromPoint(event.clientX, event.clientY));
    },
    [continueInputGesture, interactive, tileFromPoint]
  );
  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || activePointerIdRef.current !== event.pointerId) {
        return;
      }

      continueInputGesture(tileFromPoint(event.clientX, event.clientY));
      activePointerIdRef.current = null;
      inputPainterRef.current.end();
      clearPointerFocus();
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }
    },
    [clearPointerFocus, continueInputGesture, interactive, tileFromPoint]
  );
  const handleLostPointerCapture = useCallback(() => {
    activePointerIdRef.current = null;
    inputPainterRef.current.end();
    clearPointerFocus();
  }, [clearPointerFocus]);
  const handleKeyboardActivation = useCallback((tile: FloorInputTile) => {
    applyInputActions(inputPainterRef.current.begin(tile));
    inputPainterRef.current.end();
  }, [applyInputActions]);
  const firstTile = frame.cells[0];
  const firstTileKey = firstTile ? `${firstTile.x}:${firstTile.y}` : "";
  const rovingTileKey = frame.cells.some((cell) => `${cell.x}:${cell.y}` === keyboardTileKey)
    ? keyboardTileKey
    : firstTileKey;
  const focusKeyboardTile = useCallback((tile: FloorInputTile) => {
    const key = `${tile.x}:${tile.y}`;
    setKeyboardTileKey(key);
    window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-tile-x="${tile.x}"][data-tile-y="${tile.y}"]`)
        ?.focus({ preventScroll: true });
    });
  }, []);

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
      aria-colcount={frame.width}
      aria-label={ariaLabel}
      aria-rowcount={frame.height}
    >
      {frame.cells.map((cell) => {
        const tileStyle = {
          backgroundColor: cell.color,
          gridColumnStart: cell.x + 1,
          gridRowStart: cell.y + 1
        } as CSSProperties;
        const key = `${cell.x}-${cell.y}`;
        const tileKey = `${cell.x}:${cell.y}`;
        const occupied = occupiedTileKeys.has(tileKey);
        const authoritativelyPressed = cell.pressed === true;
        const sharedProps = {
          className: `ml-floor-tile ${authoritativelyPressed ? "ml-floor-tile-authoritative-pressed" : ""}`.trim(),
          style: tileStyle,
          "data-tile-x": cell.x,
          "data-tile-y": cell.y,
          "data-color": cell.color,
          "data-authoritative-pressed": authoritativelyPressed ? "true" : "false",
          "data-input-pressed": occupied ? "true" : "false"
        };

        if (interactive) {
          return (
            <button
              {...sharedProps}
              aria-label={`Baldosa ${cell.x}, ${cell.y}; ${authoritativelyPressed ? "presión física detectada" : "sin presión física"}`}
              aria-pressed={occupied}
              key={key}
              onClick={(event) => {
                if (event.detail === 0) {
                  handleKeyboardActivation(cell);
                }
              }}
              onFocus={() => setKeyboardTileKey(tileKey)}
              onKeyDown={(event) => {
                const nextTile = floorTileAfterKeyboardNavigation(cell, event.key, frame.width, frame.height);
                if (!nextTile) return;
                event.preventDefault();
                focusKeyboardTile(nextTile);
              }}
              tabIndex={tileKey === rovingTileKey ? 0 : -1}
              type="button"
            />
          );
        }

        return <span {...sharedProps} aria-hidden="true" key={key} />;
      })}
    </div>
  );
}
