import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  displayToFloorCoordinate,
  floorDisplaySize,
  floorToDisplayCoordinate,
  normalizeFloorRotationDegrees,
  type FloorRotationDegrees,
  type FrameCell
} from "@motion-levels-games/game-sdk";
import {
  FloorInputPainter,
  floorTileFromClientPoint,
  type FloorInputAction,
  type FloorInputMode,
  type FloorInputTile
} from "./floor-input-painter.ts";
import { usePlayerDisplayRuntime } from "./player-display-runtime.tsx";

export type FloorPreviewCell = FrameCell & { pressed?: boolean };
export type FloorPreviewFrame = { width: number; height: number; cells: FloorPreviewCell[] };
export type FloorPreviewProps = {
  ariaLabel?: string;
  className?: string;
  frame: FloorPreviewFrame;
  inputResetKey?: string | number;
  inputMode?: FloorInputMode;
  interactive?: boolean;
  rotationDegrees?: FloorRotationDegrees;
  onInputActions?: (actions: readonly FloorInputAction[]) => void;
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
    <section
      className={`ml-frame-preview-panel ${className}`.trim()}
      data-display-containment="frame-preview"
    >
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
  inputMode = "latched",
  onInputActions,
  onTilePress,
  onTileRelease,
  rotationDegrees,
  className = ""
}: FloorPreviewProps) {
  const runtime = usePlayerDisplayRuntime();
  const floorRotation = normalizeFloorRotationDegrees(rotationDegrees ?? runtime.floorRotationDegrees);
  const displaySize = floorDisplaySize(frame.width, frame.height, floorRotation);
  const rootRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const inputPainterRef = useRef(new FloorInputPainter(inputMode));
  const previousInputModeRef = useRef(inputMode);
  const previousInputResetKeyRef = useRef(inputResetKey);
  const [occupiedTileKeys, setOccupiedTileKeys] = useState(() => new Set<string>());
  const [keyboardTileKey, setKeyboardTileKey] = useState("");
  const style = {
    "--ml-floor-cols": displaySize.width,
    "--ml-floor-rows": displaySize.height
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

    const displayTile = floorTileFromClientPoint(
      clientX,
      clientY,
      root.getBoundingClientRect(),
      displaySize.width,
      displaySize.height
    );
    return displayTile
      ? displayToFloorCoordinate(displayTile, frame.width, frame.height, floorRotation)
      : null;
  }, [displaySize.height, displaySize.width, floorRotation, frame.height, frame.width]);
  const applyInputActions = useCallback((actions: FloorInputAction[]) => {
    if (actions.length === 0) {
      return;
    }

    if (onInputActions) {
      onInputActions(actions);
    } else {
      for (const action of actions) {
        if (action.pressed) {
          onTilePress?.(action.x, action.y);
        } else {
          onTileRelease?.(action.x, action.y);
        }
      }
    }
    setOccupiedTileKeys(new Set(inputPainterRef.current.keys()));
  }, [onInputActions, onTilePress, onTileRelease]);
  const beginInputGesture = useCallback((tile: FloorInputTile | null) => {
    if (!tile || Number.isNaN(tile.x) || Number.isNaN(tile.y)) {
      return;
    }

    applyInputActions(inputPainterRef.current.begin(tile));
  }, [applyInputActions]);
  const continueInputGesture = useCallback((tile: FloorInputTile | null) => {
    if (tile && (Number.isNaN(tile.x) || Number.isNaN(tile.y))) {
      return;
    }

    applyInputActions(inputPainterRef.current.move(tile));
  }, [applyInputActions]);
  const endInputGesture = useCallback(() => {
    applyInputActions(inputPainterRef.current.end());
  }, [applyInputActions]);
  const clearInputPainter = useCallback(() => {
    inputPainterRef.current.reset();
    setOccupiedTileKeys(new Set());
  }, []);
  useEffect(() => {
    if (previousInputModeRef.current === inputMode) {
      return;
    }

    previousInputModeRef.current = inputMode;
    inputPainterRef.current = new FloorInputPainter(inputMode);
    setOccupiedTileKeys(new Set());
  }, [inputMode]);
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
      endInputGesture();
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
  }, [endInputGesture, interactive]);
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
      endInputGesture();
      clearPointerFocus();
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }
    },
    [clearPointerFocus, continueInputGesture, endInputGesture, interactive, tileFromPoint]
  );
  const handleLostPointerCapture = useCallback(() => {
    activePointerIdRef.current = null;
    endInputGesture();
    clearPointerFocus();
  }, [clearPointerFocus, endInputGesture]);
  const handleKeyboardActivation = useCallback((tile: FloorInputTile) => {
    applyInputActions(inputPainterRef.current.begin(tile));
    endInputGesture();
  }, [applyInputActions, endInputGesture]);
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
  const keyboardTileAfterNavigation = useCallback((tile: FloorInputTile, key: string) => {
    const displayedTile = floorToDisplayCoordinate(tile, frame.width, frame.height, floorRotation);
    const nextDisplayedTile = floorTileAfterKeyboardNavigation(
      displayedTile,
      key,
      displaySize.width,
      displaySize.height
    );
    return nextDisplayedTile
      ? displayToFloorCoordinate(nextDisplayedTile, frame.width, frame.height, floorRotation)
      : null;
  }, [displaySize.height, displaySize.width, floorRotation, frame.height, frame.width]);

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
      aria-colcount={displaySize.width}
      aria-label={ariaLabel}
      aria-rowcount={displaySize.height}
      data-display-containment="floor-preview"
      data-floor-rotation={floorRotation}
    >
      {frame.cells.map((cell) => {
        const displayedCell = floorToDisplayCoordinate(cell, frame.width, frame.height, floorRotation);
        const tileStyle = {
          backgroundColor: cell.color,
          gridColumnStart: displayedCell.x + 1,
          gridRowStart: displayedCell.y + 1
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
                const nextTile = keyboardTileAfterNavigation(cell, event.key);
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
