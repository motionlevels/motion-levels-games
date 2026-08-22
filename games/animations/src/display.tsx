/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { FramePreviewPanel, GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { AnimationSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot, frame }: { snapshot: AnimationSnapshot; frame?: Frame }) {
  const accent = readableAccent(snapshot.palette);
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <section className="animation-display is-live" style={{ "--animation-accent": accent } as CSSProperties}>
        <div className="animation-copy">
          <div className="animation-copy-main">
            <span className="animation-kicker">Experiencia ambiental</span>
            <h2>{snapshot.animationLabel}</h2>
            <p>{snapshot.lastEventMessage}</p>
            <div className="animation-palette" aria-label="Paleta de color">
              {snapshot.palette.map((color) => <i key={color} style={{ "--swatch": color } as CSSProperties} />)}
            </div>
          </div>
          <footer className="animation-meta"><i /><b>En directo</b><span>{snapshot.rotationSize} animaciones</span><span>{snapshot.activeTargets} interacciones</span></footer>
        </div>
        <div className="animation-stage">
          {frame ? <FramePreviewPanel className="animation-floor" frame={frame} label="Suelo 16 × 32" /> : null}
          <div className="animation-countdown" aria-label={countdownAriaLabel(snapshot)}>
            <div className="animation-countdown-copy">
              <span>{snapshot.rotationActive ? "Cambio en" : "Reproducción"}</span>
              <strong>{snapshot.rotationActive ? formatClock(snapshot.rotationRemainingMillis) : "Fija"}</strong>
              <small>{snapshot.rotationActive ? "Siguiente animación" : "Sin cambio automático"}</small>
            </div>
          </div>
        </div>
      </section>
    </GameDisplayShell>
  );
}

function readableAccent(palette: readonly string[]): string {
  const accent = palette[1] ?? palette[0] ?? "#42ffd2";
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(accent);
  if (!match) return accent;
  const [, red = "ff", green = "ff", blue = "ff"] = match;
  const brightness = (Number.parseInt(red, 16) * 299 + Number.parseInt(green, 16) * 587 + Number.parseInt(blue, 16) * 114) / 1_000;
  return brightness < 48 ? "#8fa2bd" : accent;
}

function countdownAriaLabel(snapshot: AnimationSnapshot): string {
  return snapshot.rotationActive
    ? `La siguiente animación empieza en ${formatClock(snapshot.rotationRemainingMillis)}`
    : "Animación fija sin cambio automático";
}
