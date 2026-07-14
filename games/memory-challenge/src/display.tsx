/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame, type HexColor } from "@motion-levels-games/game-sdk";
import type { MemoryChallengeSnapshot, MemoryPlayerProgress } from "./game.ts";

export function PlayerDisplay({ snapshot }: { snapshot: MemoryChallengeSnapshot; frame?: Frame }) {
  const countdown = Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000));
  const hero = heroContent(snapshot, countdown);
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className={`memory-challenge-display is-phase-${snapshot.phase} is-stage-${snapshot.memoryStage}`}>
        <section className="memory-challenge-hero">
          <div><span>{hero.eyebrow}</span><strong>{hero.title}</strong><b>{hero.caption}</b></div>
          <article><span>Tiempo</span><strong>{formatClock(snapshot.remainingMillis)}</strong></article>
          <article><span>Mejor camino</span><strong>{snapshot.score}</strong></article>
        </section>
        <section className="memory-challenge-players" style={{ "--memory-columns": snapshot.playerCount } as CSSProperties}>
          {snapshot.playerProgress.map((player) => (
            <PlayerCard key={player.index} player={player} ready={snapshot.readyPlayerIndices.includes(player.index)} winner={snapshot.winnerIndex === player.index} />
          ))}
        </section>
        <footer className="memory-challenge-event">
          <span>{snapshot.phase === "finished" ? "Resultado" : "Último evento"}</span>
          <strong key={snapshot.motionEventId}>{snapshot.lastEventMessage}</strong>
          <b>{snapshot.phase === "running" ? stageLabel(snapshot) : `${snapshot.readyPlayers}/${snapshot.requiredPlayers} listos`}</b>
        </footer>
      </div>
    </GameDisplayShell>
  );
}

function PlayerCard({ player, ready, winner }: { player: MemoryPlayerProgress; ready: boolean; winner: boolean }) {
  const progress = player.pathLength === 0 ? 0 : player.bestProgress / player.pathLength;
  const style = { "--memory-player": player.color, "--memory-player-rgb": hexToRgb(player.color), "--memory-progress": progress } as CSSProperties;
  const status = winner ? "Ganador" : player.status === "failed" ? "Vuelve al inicio" : player.status === "memorizing" ? "Memoriza" : ready ? "Listo" : "En carrera";
  return (
    <article className={`memory-challenge-player is-${player.status}${winner ? " is-winner" : ""}`} style={style}>
      <header><i /><strong>{player.label}</strong><b>{status}</b></header>
      <div className="memory-challenge-score"><strong>{player.bestProgress}</strong><span>de {player.pathLength} baldosas</span></div>
      <div className="memory-challenge-track"><i /></div>
      <footer><span>Avance actual</span><strong>{Math.round(progress * 100)}%</strong></footer>
    </article>
  );
}

function heroContent(snapshot: MemoryChallengeSnapshot, countdown: number) {
  if (snapshot.phase === "waiting") return { eyebrow: `Listos ${snapshot.readyPlayers}/${snapshot.requiredPlayers}`, title: "Busca tu salida", caption: "Cada jugador ocupa la zona iluminada de su calle" };
  if (snapshot.phase === "starting") return { eyebrow: "Todos listos", title: String(countdown), caption: "Mira bien: tu camino aparecerá enseguida" };
  if (snapshot.phase === "finished") return snapshot.winnerIndex >= 0
    ? { eyebrow: "Camino completado", title: `¡Gana ${snapshot.winnerLabel}!`, caption: "La ruta vencedora vuelve a iluminarse" }
    : { eyebrow: "Tiempo agotado", title: "La lava gana", caption: "Nueva carrera en unos segundos" };
  if (snapshot.memoryStage === "memorize") return { eyebrow: `Oculto en ${formatClock(snapshot.stageMillis)}`, title: "Memoriza tu camino", caption: "Sigue el color desde tu salida hasta el final" };
  return { eyebrow: "Camino oculto", title: "Avanza de memoria", caption: "Si fallas, vuelve a tu salida para ver la ruta otra vez" };
}

function stageLabel(snapshot: MemoryChallengeSnapshot): string {
  return snapshot.memoryStage === "memorize" ? `Se oculta en ${formatClock(snapshot.stageMillis)}` : "Camino oculto";
}

function hexToRgb(color: HexColor): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "255, 255, 255";
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)).join(", ");
}
