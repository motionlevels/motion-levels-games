import React from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Frame } from "@motion-levels-games/game-sdk";

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
  className = ""
}: {
  frame: Frame;
  interactive?: boolean;
  onTilePress?: (x: number, y: number) => void;
  className?: string;
}) {
  const style = {
    "--ml-floor-cols": frame.width,
    "--ml-floor-rows": frame.height
  } as CSSProperties;
  const rootClassName = `ml-floor-preview ${interactive ? "ml-floor-interactive" : ""} ${className}`.trim();

  return (
    <div className={rootClassName} style={style} role="grid" aria-label="Floor preview">
      {frame.cells.map((cell) => {
        const tileStyle = { backgroundColor: cell.color } as CSSProperties;
        const key = `${cell.x}-${cell.y}`;
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
              aria-label={`Tile ${cell.x}, ${cell.y}`}
              key={key}
              onPointerDown={() => onTilePress?.(cell.x, cell.y)}
              type="button"
            />
          );
        }

        return <span {...sharedProps} aria-hidden="true" key={key} />;
      })}
    </div>
  );
}
