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

const sueloSeguroStyles = `
.suelo-seguro-display{background:radial-gradient(circle at 50% 42%,rgba(53,215,255,.14),transparent 32%),linear-gradient(145deg,#02070b,#071219 54%,#18050c);display:grid;gap:28px;grid-template-columns:390px minmax(0,1fr) 430px;inset:0;overflow:hidden;padding:34px 40px;position:absolute}
.suelo-seguro-floor{align-content:center;background:rgba(2,8,12,.82);border:1px solid rgba(255,255,255,.11);border-radius:28px;display:grid;justify-items:center;padding:22px}.suelo-seguro-floor>span{color:#9bb1bc;font-size:19px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.suelo-seguro-floor .ml-floor-preview{height:720px;width:360px}
.suelo-seguro-main{align-content:center;display:grid;gap:24px;min-width:0}.suelo-seguro-turn{background:linear-gradient(145deg,rgba(8,18,26,.96),color-mix(in srgb,var(--active-color) 15%,#071017));border:4px solid var(--active-color);border-radius:30px;box-shadow:0 0 58px color-mix(in srgb,var(--active-color) 28%,transparent);display:grid;gap:15px;justify-items:center;min-height:270px;padding:32px;text-align:center}.suelo-seguro-turn span{color:#b8c8d0;font-size:22px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.suelo-seguro-turn strong{color:#fff;font-size:clamp(52px,4.1vw,78px);line-height:1;white-space:normal}.suelo-seguro-turn b{color:var(--active-color);font-size:30px;line-height:1.15;white-space:normal}
.suelo-seguro-turn-clock{background:#111d22;border-radius:999px;height:18px;overflow:hidden;width:100%}.suelo-seguro-turn-clock i{background:linear-gradient(90deg,#ff183d,#ffe176,var(--active-color));display:block;height:100%;transition:width .1s linear;width:var(--turn-progress)}
.suelo-seguro-players{display:grid;gap:12px;grid-template-columns:repeat(var(--player-columns),minmax(0,1fr))}.suelo-seguro-player{align-items:center;background:rgba(7,16,23,.9);border:2px solid color-mix(in srgb,var(--player-color) 35%,transparent);border-radius:18px;display:grid;gap:7px;grid-template-columns:13px minmax(0,1fr);padding:12px 16px}.suelo-seguro-player.is-active{background:color-mix(in srgb,var(--player-color) 18%,#071017);border-color:var(--player-color);box-shadow:0 0 24px color-mix(in srgb,var(--player-color) 25%,transparent)}.suelo-seguro-player i{background:var(--player-color);border-radius:5px;box-shadow:0 0 13px var(--player-color);grid-row:1/3;height:38px}.suelo-seguro-player span{color:#fff;font-size:19px;font-weight:900;line-height:1.05;min-width:0;white-space:normal}.suelo-seguro-player strong{color:var(--player-color);font-size:27px;line-height:1;white-space:normal}
.suelo-seguro-sidebar{align-content:center;display:grid;gap:18px}.suelo-seguro-card{background:rgba(5,14,20,.92);border:1px solid rgba(255,255,255,.12);border-radius:23px;display:grid;gap:10px;padding:22px 25px}.suelo-seguro-card>span{color:#9fb2bc;font-size:19px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.suelo-seguro-card strong{color:#fff;font-size:60px;line-height:1}.suelo-seguro-card small{color:#9fb2bc;font-size:18px;font-weight:800;line-height:1.25;white-space:normal}.suelo-seguro-lives .ml-lives-meter{justify-content:flex-start}.suelo-seguro-progress{background:#142229;border-radius:999px;height:14px;overflow:hidden}.suelo-seguro-progress i{background:linear-gradient(90deg,#35d7ff,#5fff9e,#ffe176);display:block;height:100%;width:var(--relay-progress)}.suelo-seguro-event{background:rgba(53,215,255,.08);border:1px solid rgba(53,215,255,.26);border-radius:21px;color:#fff;font-size:25px;font-weight:900;line-height:1.15;min-height:92px;padding:23px;white-space:normal}
.suelo-seguro-result{align-content:center;background:rgba(2,7,11,.95);display:grid;inset:0;justify-items:center;padding:70px;position:absolute;text-align:center;z-index:6}.suelo-seguro-result strong{color:#fff;font-size:clamp(76px,7vw,132px);line-height:.95;white-space:normal}.suelo-seguro-result span{color:#c8dae2;font-size:32px;font-weight:900;margin-top:26px;white-space:normal}.suelo-seguro-result.is-round{animation:sueloRound .7s ease-in-out infinite alternate;background:linear-gradient(120deg,#062135,color-mix(in srgb,var(--active-color) 38%,#07131b),#0a3a29)}.suelo-seguro-result.is-game-fail strong{color:#ff526e}.suelo-seguro-result.is-game-win{animation:sueloWin 1.1s linear infinite;background:linear-gradient(110deg,#06304a,#501448,#6c5c0e,#15573b,#06304a);background-size:260% 100%}
.suelo-seguro-life-lost{align-items:center;animation:sueloLifeLost 1.2s ease-out both;background:rgba(31,8,14,.92);border:1px solid rgba(255,82,110,.55);border-radius:18px;bottom:36px;box-shadow:0 18px 45px rgba(0,0,0,.38);display:flex;gap:14px;left:50%;padding:16px 24px;position:absolute;transform:translateX(-50%);z-index:7}.suelo-seguro-life-lost strong{color:#ff8297;font-size:26px;white-space:normal}.suelo-seguro-life-lost span{color:#d8c2c7;font-size:20px;font-weight:800;white-space:normal}
@keyframes sueloRound{from{filter:saturate(.85);transform:scale(1)}to{filter:saturate(1.35);transform:scale(1.012)}}@keyframes sueloWin{from{background-position:0 0}to{background-position:100% 0}}@keyframes sueloLifeLost{0%{opacity:0;transform:translate(-50%,10px)}16%,78%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}@media(prefers-reduced-motion:reduce){.suelo-seguro-display *{animation:none!important;transition:none!important}}
`;

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
        <style>{sueloSeguroStyles}</style>
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
