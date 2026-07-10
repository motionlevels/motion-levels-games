import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Frame, FrameCell } from "@motion-levels-games/game-sdk";
import {
  FloorInputPainter,
  floorTileFromClientPoint,
  type FloorInputAction,
  type FloorInputTile
} from "./floor-input-painter.ts";

type PreviewFrame = Frame | { width: number; height: number; cells: FrameCell[] };

export function FramePreviewPanel({
  frame,
  label = "Vista del suelo",
  className = ""
}: {
  frame: PreviewFrame;
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
  inputResetKey,
  onTilePress,
  onTileRelease,
  className = ""
}: {
  frame: PreviewFrame;
  interactive?: boolean;
  inputResetKey?: string | number;
  onTilePress?: (x: number, y: number) => void;
  onTileRelease?: (x: number, y: number) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const inputPainterRef = useRef(new FloorInputPainter());
  const previousInputResetKeyRef = useRef(inputResetKey);
  const [occupiedTileKeys, setOccupiedTileKeys] = useState(() => new Set<string>());
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
        const occupied = occupiedTileKeys.has(`${cell.x}:${cell.y}`);
        const sharedProps = {
          className: "ml-floor-tile",
          style: tileStyle,
          "data-tile-x": cell.x,
          "data-tile-y": cell.y,
          "data-color": cell.color
        };

        if (interactive) {
          return (
            <button
              {...sharedProps}
              aria-label={`Baldosa ${cell.x}, ${cell.y}`}
              aria-pressed={occupied}
              key={key}
              onClick={(event) => {
                if (event.detail === 0) {
                  handleKeyboardActivation(cell);
                }
              }}
              type="button"
            />
          );
        }

        return <span {...sharedProps} aria-hidden="true" key={key} />;
      })}
    </div>
  );
}
