/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame, type HexColor } from "@motion-levels-games/game-sdk";
import type { MolePlayerProgress, WhackAMoleSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot }: { snapshot: WhackAMoleSnapshot; frame?: Frame }) {
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  const leader = snapshot.playerProgress.reduce((best, player) => player.score > (snapshot.playerProgress[best]?.score ?? -1) ? player.index : best, 0);
  const hero = heroContent(snapshot);
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className={`duelo-display whack-display is-phase-${snapshot.phase}`} style={{ "--duelo-grid-columns": columns } as CSSProperties}>
        <section className="duelo-hero"><div className="duelo-hero-copy"><span>{hero.eyebrow}</span><strong>{hero.title}</strong><b>{hero.caption}</b></div><div className="duelo-hero-metrics"><Metric label="Tiempo" value={formatClock(snapshot.remainingMillis)} /><Metric label="Topos" value={snapshot.activeTargets} /><Metric label="Puntos" value={snapshot.score} /></div></section>
        <section className="duelo-player-grid" aria-label="Puntuación de jugadores">
          {snapshot.playerProgress.map((player) => <PlayerCard key={player.index} player={player} leader={leader === player.index} ready={snapshot.readyPlayerIndices.includes(player.index)} winner={snapshot.winnerIndex === player.index} />)}
        </section>
        <footer className="duelo-event-rail"><span>{snapshot.phase === "finished" ? "Resultado" : "Último evento"}</span><strong key={snapshot.motionEventId}>{snapshot.lastEventMessage}</strong><b>{snapshot.phase === "running" ? `${snapshot.activeTargets} objetivos activos` : `${snapshot.readyPlayers}/${snapshot.requiredPlayers} listos`}</b></footer>
      </div>
    </GameDisplayShell>
  );
}

function PlayerCard({ player, leader, ready, winner }: { player: MolePlayerProgress; leader: boolean; ready: boolean; winner: boolean }) {
  const style = { "--duelo-player": player.color, "--duelo-player-rgb": hexToRgb(player.color), "--duelo-progress": Math.min(1, player.score / 100) } as CSSProperties;
  const status = winner ? "Ganador" : leader && player.score > 0 ? "Líder" : ready ? "Listo" : "Busca tu color";
  return <article className={`duelo-player-card${winner ? " is-winner" : ""}${leader ? " is-leader" : ""}`} style={style}><header><i /><span className="duelo-player-name">{player.label}</span><b>{status}</b></header><div className="duelo-player-score"><strong>{player.score}</strong><span>puntos</span>{player.lastPoints > 0 ? <em key={`${player.index}-${player.hits}`}>+{player.lastPoints}</em> : null}</div><div className="duelo-player-track"><i /></div><footer><span>Topos atrapados</span><strong>{player.hits}</strong></footer></article>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <article className="duelo-hero-metric"><span>{label}</span><strong>{value}</strong></article>; }
function heroContent(snapshot: WhackAMoleSnapshot) {
  if (snapshot.phase === "waiting") return { eyebrow: `Listos ${snapshot.readyPlayers}/${snapshot.requiredPlayers}`, title: "Busca tu plataforma", caption: "Cada jugador permanece sobre su color" };
  if (snapshot.phase === "starting") return { eyebrow: "Todos listos", title: String(Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000))), caption: "Los topos están a punto de aparecer" };
  if (snapshot.phase === "finished") return { eyebrow: "Tiempo", title: `¡Gana ${snapshot.winnerLabel}!`, caption: "Más velocidad, más puntos" };
  return { eyebrow: "Todos contra todos", title: "¡Atrapa los topos!", caption: "Corre hacia los cuadrados de colores antes de que se apaguen" };
}
function hexToRgb(color: HexColor): string { return /^#[0-9a-f]{6}$/i.test(color) ? [1,3,5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)).join(", ") : "255, 255, 255"; }
