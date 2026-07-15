/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import type { Frame, HexColor } from "@motion-levels-games/game-sdk";
import type { EstelaPlayerProgress, EstelaSnapshot } from "./game.ts";

const estelaStyles = `
.estela-display .duelo-hero { grid-template-columns: minmax(0,1fr) 480px; }
.estela-display .duelo-player-grid { align-content: stretch; }
.estela-display .duelo-player-card.is-eliminated { filter: grayscale(.78); opacity: .48; }
.estela-display .duelo-player-card.is-round-winner,
.estela-display .duelo-player-card.is-game-winner { animation: estelaWinnerCard .7s ease-in-out infinite alternate; }
.estela-display .duelo-player-track > i { width: var(--estela-trail-progress); }
.estela-display .duelo-player-card footer strong { color: var(--duelo-player); }
.estela-result { align-content:center; background:rgba(3,6,14,.9); display:grid; inset:0; justify-items:center; position:absolute; z-index:4; }
.estela-result strong { color:#fff; font-size:clamp(66px,5vw,96px); line-height:1; text-align:center; }
.estela-result span { color:#36d9ff; font-size:25px; font-weight:900; margin-top:18px; text-transform:uppercase; }
.estela-result.is-round-win { animation:estelaRoundWin .58s ease-in-out infinite alternate; }
.estela-result.is-game-win { animation:estelaGameWin .9s linear infinite; background:linear-gradient(100deg,rgba(3,6,14,.94),rgba(216,92,255,.28),rgba(38,217,255,.28),rgba(3,6,14,.94)); background-size:220% 100%; }
@keyframes estelaWinnerCard { from { filter:brightness(1); } to { filter:brightness(1.3); } }
@keyframes estelaRoundWin { from { box-shadow:inset 0 0 40px rgba(54,217,255,.14); } to { box-shadow:inset 0 0 110px rgba(216,92,255,.42); } }
@keyframes estelaGameWin { from { background-position:0 0; } to { background-position:100% 0; } }
@media (prefers-reduced-motion:reduce) { .estela-display *, .estela-display *::before, .estela-display *::after { animation:none!important; transition:none!important; } }
`;

export function PlayerDisplay({ snapshot }: { snapshot: EstelaSnapshot; frame?: Frame }) {
  const hero = heroContent(snapshot);
  const shellPhase = snapshot.phase === "round-win" ? "running" : snapshot.phase;
  const winner = snapshot.gameWinnerIndex >= 0 ? snapshot.playerProgress[snapshot.gameWinnerIndex] : undefined;
  const roundWinner = snapshot.roundWinnerIndex >= 0 ? snapshot.playerProgress[snapshot.roundWinnerIndex] : undefined;
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  return (
    <GameDisplayShell title={snapshot.label} phase={shellPhase}>
      <div className={`duelo-display estela-display is-phase-${snapshot.phase}`} style={{ "--duelo-grid-columns": columns } as CSSProperties}>
        <style>{estelaStyles}</style>
        <PlayerReadyOverlay snapshot={snapshot} />
        <section className="duelo-hero">
          <div className="duelo-hero-copy"><span>{hero.eyebrow}</span><strong>{hero.title}</strong><b>{hero.caption}</b></div>
          <div className="duelo-hero-metrics"><Metric label="Ronda" value={snapshot.currentRound} /><Metric label="En pie" value={snapshot.activeTargets} /><Metric label="Borde" value={snapshot.arenaInset} /></div>
          {snapshot.phase === "round-win" && roundWinner ? <Result className="is-round-win" title={`Ronda para ${roundWinner.label}`} caption="La siguiente ronda empieza en breve" /> : null}
          {snapshot.phase === "finished" && winner ? <Result className="is-game-win" title={`¡Gana ${winner.label}!`} caption={`${winner.roundWins} rondas ganadas`} /> : null}
        </section>
        <section className="duelo-player-grid" aria-label="Jugadores de Estela">
          {snapshot.playerProgress.map((player) => <PlayerCard key={player.index} player={player} roundWinner={snapshot.roundWinnerIndex === player.index} gameWinner={snapshot.gameWinnerIndex === player.index} target={snapshot.roundsToWin} />)}
        </section>
        <footer className="duelo-event-rail"><span>Último evento</span><strong>{snapshot.lastEventMessage}</strong><b>Primero en ganar {snapshot.roundsToWin} rondas</b></footer>
      </div>
    </GameDisplayShell>
  );
}

function PlayerCard({ player, roundWinner, gameWinner, target }: { player: EstelaPlayerProgress; roundWinner: boolean; gameWinner: boolean; target: number }) {
  const style = {
    "--duelo-player": player.color,
    "--duelo-player-rgb": hexToRgb(player.color),
    "--duelo-progress": player.roundWins / Math.max(target, 1),
    "--estela-trail-progress": `${Math.min(100, player.trailLength * 5)}%`
  } as CSSProperties;
  const classes = `${player.alive ? "" : " is-eliminated"}${roundWinner ? " is-round-winner" : ""}${gameWinner ? " is-game-winner" : ""}`;
  return <article className={`duelo-player-card${classes}`} style={style}><header><i /><span className="duelo-player-name">{player.label}</span><b>{gameWinner ? "Ganador" : roundWinner ? "Gana la ronda" : player.alive ? "En juego" : "Eliminado"}</b></header><div className="duelo-player-score"><strong>{player.roundWins}</strong><span>rondas</span></div><div className="duelo-player-track"><i /></div><footer><span>Longitud de estela</span><strong>{player.trailLength}</strong></footer></article>;
}

function Metric({ label, value }: { label: string; value: number }) { return <article className="duelo-hero-metric"><span>{label}</span><strong>{value}</strong></article>; }
function Result({ className, title, caption }: { className: string; title: string; caption: string }) { return <div className={`estela-result ${className}`}><strong>{title}</strong><span>{caption}</span></div>; }
function heroContent(snapshot: EstelaSnapshot) {
  if (snapshot.phase === "waiting") return { eyebrow: `Listos ${snapshot.readyPlayers}/${snapshot.requiredPlayers}`, title: "Busca tu color", caption: "Cada jugador permanece en su plataforma" };
  if (snapshot.phase === "starting") return { eyebrow: "Todos listos", title: String(Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000))), caption: "Prepara tu primera dirección" };
  if (snapshot.phase === "round-win") return { eyebrow: `Ronda ${snapshot.currentRound}`, title: "Último en pie", caption: "Las estelas se reinician para la siguiente ronda" };
  if (snapshot.phase === "finished") return { eyebrow: "Partida terminada", title: "Victoria", caption: "La luz más resistente domina la pista" };
  return { eyebrow: `Ronda ${snapshot.currentRound}`, title: "¡No cruces las estelas!", caption: "El borde rojo se acerca durante la ronda" };
}
function hexToRgb(color: HexColor): string { return /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)).join(", ") : "255, 255, 255"; }
