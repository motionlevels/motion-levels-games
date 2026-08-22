/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { AnimationSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot }: { snapshot: AnimationSnapshot; frame?: Frame }) {
  const accent = readableAccent(snapshot.palette);
  const visualTones = [1, 2, 3, 4].map((index) => readableTone(snapshot.palette[index], accent));
  const interactionLabel = snapshot.activeTargets === 1 ? "Interacción activa" : "Interacciones activas";
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <section
        className="animation-display is-live"
        style={{
          "--animation-accent": accent,
          "--animation-tone-1": visualTones[0],
          "--animation-tone-2": visualTones[1],
          "--animation-tone-3": visualTones[2],
          "--animation-tone-4": visualTones[3]
        } as CSSProperties}
      >
        <div className="animation-lightfield" aria-hidden="true">
          <i className="animation-light animation-light-one" />
          <i className="animation-light animation-light-two" />
          <i className="animation-light animation-light-three" />
          <i className="animation-light animation-light-four" />
          <span className="animation-light-core" />
        </div>

        <div className="animation-hero">
          <div className="animation-copy">
            <span className="animation-kicker">Experiencia ambiental</span>
            <h2>{snapshot.animationLabel}</h2>
            <p className="animation-message">{snapshot.lastEventMessage}</p>
            <div className="animation-palette" aria-label="Paleta activa">
              <span>Paleta activa</span>
              <div>
                {snapshot.palette.map((color, index) => (
                  <i key={`${color}-${index}`} style={{ "--swatch": color } as CSSProperties} />
                ))}
              </div>
            </div>
          </div>

          <aside className="animation-playback" aria-label={countdownAriaLabel(snapshot)}>
            <span className="animation-playback-kicker">
              {snapshot.rotationActive ? "Siguiente cambio" : "Reproducción"}
            </span>
            <strong>{snapshot.rotationActive ? formatClock(snapshot.rotationRemainingMillis) : "Fija"}</strong>
            <p>{snapshot.rotationActive ? "Siguiente animación" : "Sin cambio automático"}</p>
            {snapshot.rotationActive ? (
              <div className="animation-sequence">
                <span>Secuencia activa</span>
                <b>{snapshot.rotationIndex + 1} / {snapshot.rotationSize}</b>
              </div>
            ) : (
              <span className="animation-mode-chip">Modo continuo</span>
            )}
          </aside>
        </div>

        <footer className="animation-footer">
          <div className="animation-live-status">
            <i />
            <span>En directo</span>
          </div>
          <div className="animation-stat">
            <strong>{snapshot.rotationSize}</strong>
            <span>Animaciones</span>
          </div>
          <div className="animation-stat">
            <strong>{snapshot.activeTargets}</strong>
            <span>{interactionLabel}</span>
          </div>
        </footer>
      </section>
    </GameDisplayShell>
  );
}

function readableAccent(palette: readonly string[]): string {
  const accent = palette[1] ?? palette[0] ?? "#42ffd2";
  return colorBrightness(accent) < 48 ? "#8fa2bd" : accent;
}

function readableTone(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return colorBrightness(color) < 28 ? fallback : color;
}

function colorBrightness(color: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
  if (!match) return 255;
  const [, red = "ff", green = "ff", blue = "ff"] = match;
  return (Number.parseInt(red, 16) * 299 + Number.parseInt(green, 16) * 587 + Number.parseInt(blue, 16) * 114) / 1_000;
}

function countdownAriaLabel(snapshot: AnimationSnapshot): string {
  return snapshot.rotationActive
    ? `La siguiente animación empieza en ${formatClock(snapshot.rotationRemainingMillis)}`
    : "Animación fija sin cambio automático";
}
