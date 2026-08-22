/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import {
  FramePreviewPanel,
  GameDisplayShell,
  LivesMeter,
  PlayerReadyOverlay
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { SueloSeguroSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot, frame }: { snapshot: SueloSeguroSnapshot; frame?: Frame }) {
  const active = snapshot.players[snapshot.activePlayerIndex];
  const turnProgress = snapshot.turnDurationMillis > 0 ? snapshot.turnRemainingMillis / snapshot.turnDurationMillis * 100 : 0;
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  const style = {
    "--active-color": active?.color ?? "#5fff9e",
    "--player-columns": columns,
    "--relay-progress": `${snapshot.completedTransfers / Math.max(snapshot.requiredTransfers, 1) * 100}%`,
    "--turn-progress": `${turnProgress}%`
  } as CSSProperties;
  const shellPhase = snapshot.phase === "round-win" || snapshot.phase === "turn-fail" ? "running" : snapshot.phase;
  return (
    <GameDisplayShell title={snapshot.label} phase={shellPhase}>
      <div className="suelo-seguro-display" style={style}>
        <PlayerReadyOverlay snapshot={snapshot} />
        {frame ? <FramePreviewPanel className="suelo-seguro-floor" frame={frame} label="Pista en movimiento" /> : <div />}
        <main className="suelo-seguro-main">
          <section className="suelo-seguro-turn">
            <span>Turno de</span>
            <strong>{snapshot.activePlayerLabel}</strong>
            <b>{snapshot.phase === "running" ? "Busca la plataforma de tu color" : "Prepárate para el siguiente relevo"}</b>
            <div className="suelo-seguro-turn-clock"><i /></div>
          </section>
          <section className="suelo-seguro-players" aria-label="Jugadores">
            {snapshot.players.map((player) => (
              <article className={`suelo-seguro-player${player.index === snapshot.activePlayerIndex ? " is-active" : ""}`} key={player.index} style={{ "--player-color": player.color } as CSSProperties}>
                <i /><span>{player.label}</span><strong>{player.score > 0 ? formatRelayTime(player.score) : "—"}</strong>
              </article>
            ))}
          </section>
        </main>
        <aside className="suelo-seguro-sidebar">
          <article className="suelo-seguro-card suelo-seguro-lives"><span>Vidas del equipo</span><LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} /></article>
          <article className="suelo-seguro-card"><span>Tiempo del equipo</span><strong>{formatRelayTime(snapshot.teamTransferMillis)}</strong><small>Menos es mejor · quedan {formatClock(snapshot.remainingMillis)}</small></article>
          <article className="suelo-seguro-card"><span>Relevos seguros</span><strong>{snapshot.completedTransfers}/{snapshot.requiredTransfers}</strong><div className="suelo-seguro-progress"><i /></div><small>Mejor relevo: {snapshot.bestTransferMillis === null ? "—" : formatRelayTime(snapshot.bestTransferMillis)}</small></article>
          <div className="suelo-seguro-event">{snapshot.lastEventMessage || "El suelo está preparado"}</div>
        </aside>
        {snapshot.phase === "round-win" ? <Result className="is-round" title={`¡${snapshot.activePlayerLabel} está a salvo!`} caption={`Relevo en ${formatRelayTime(snapshot.lastTransferMillis ?? 0)} · equipo ${formatRelayTime(snapshot.teamTransferMillis)}`} /> : null}
        {snapshot.lastEventCue === "damage" ? <div className="suelo-seguro-life-lost" key={snapshot.lastEventMessage} role="status"><strong>Una vida menos</strong><span>Quedan {snapshot.lives} para todo el equipo</span></div> : null}
        {snapshot.phase === "finished" ? <Result className={snapshot.success ? "is-game-win" : "is-game-fail"} title={snapshot.success ? "¡Equipo a salvo!" : "El rojo os alcanzó"} caption={snapshot.success ? `${snapshot.completedTransfers} relevos en ${formatRelayTime(snapshot.teamTransferMillis)}` : `${snapshot.completedTransfers} relevos · ${formatRelayTime(snapshot.teamTransferMillis)}`} /> : null}
      </div>
    </GameDisplayShell>
  );
}

function formatRelayTime(millis: number): string {
  return `${(Math.max(0, millis) / 1_000).toFixed(2).replace(".", ",")} s`;
}

function Result({ className, title, caption }: { className: string; title: string; caption: string }) {
  return <div className={`suelo-seguro-result ${className}`}><strong>{title}</strong><span>{caption}</span></div>;
}
