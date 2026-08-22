/** @jsxRuntime automatic */
import type { DisplayStatus } from "./api";
import { playerLifecycleLabelES } from "./displayText";
import { formatClock, gameTitleES } from "./utils";

type GamesRendererFallbackProps = {
  connected: boolean;
  error: string;
  status: DisplayStatus;
};

/**
 * A deliberately generic recovery surface used only while the
 * revision-matched game renderer is unavailable. It must never grow
 * game-specific branches: the bundled game display remains authoritative.
 */
export function GamesRendererFallback({ connected, error, status }: GamesRendererFallbackProps) {
  const lives = status.lives < 0 ? "—" : String(status.lives);
  const time = status.remainingMillis > 0
    ? formatClock(status.remainingMillis)
    : formatClock(status.elapsedMillis);

  return (
    <main className="games-renderer-fallback" aria-label="Pantalla de recuperación del juego">
      <header className="games-renderer-fallback__header">
        <span className="games-renderer-fallback__brand" aria-hidden="true">
          <i />
          <b>Motion Levels</b>
        </span>
        <span className={`games-renderer-fallback__connection${connected ? " is-connected" : ""}`}>
          <i aria-hidden="true" />
          {connected ? "Motor conectado" : "Sin conexión"}
        </span>
      </header>

      <section className="games-renderer-fallback__main">
        <span>Preparando la pantalla del juego</span>
        <h1>{gameTitleES(status.currentGame, status.label)}</h1>
        <p>{error || "Cargando el diseño correspondiente a esta versión del juego"}</p>
      </section>

      <section className="games-renderer-fallback__metrics" aria-label="Estado esencial del juego">
        <article><span>Estado</span><strong>{playerLifecycleLabelES(status.lifecycle)}</strong></article>
        <article><span>Tiempo</span><strong>{time}</strong></article>
        <article><span>Puntos</span><strong>{status.score}</strong></article>
        <article><span>Vidas</span><strong>{lives}</strong></article>
      </section>
    </main>
  );
}
