/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame, type HexColor } from "@motion-levels-games/game-sdk";
import type { DueloPlayerProgress, DueloSnapshot } from "./game.ts";

export function PlayerDisplay({
  snapshot
}: {
  snapshot: DueloSnapshot;
  frame?: Frame;
}) {
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  const countdown = Math.max(1, Math.ceil(snapshot.countdownMillis / 1_000));
  const restartCountdown = Math.max(1, Math.ceil(snapshot.remainingMillis / 1_000));
  const readyIndices = new Set(snapshot.readyPlayerIndices);
  const hero = heroContent(snapshot, countdown, restartCountdown);
  const rootStyle = {
    "--duelo-grid-columns": columns,
    "--duelo-player-count": snapshot.playerCount,
    "--duelo-winner": snapshot.winnerIndex >= 0
      ? snapshot.playerProgress[snapshot.winnerIndex]?.color ?? "#ffffff"
      : "#ffffff",
    "--duelo-winner-rgb": snapshot.winnerIndex >= 0
      ? hexToRgb(snapshot.playerProgress[snapshot.winnerIndex]?.color ?? "#ffffff")
      : "255, 255, 255"
  } as CSSProperties;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div
        className={`duelo-display is-phase-${snapshot.phase} is-player-count-${snapshot.playerCount}`}
        style={rootStyle}
      >
        <section className="duelo-hero" aria-label={hero.title}>
          <div className="duelo-hero-copy">
            <span>{hero.eyebrow}</span>
            <strong>{hero.title}</strong>
            <b>{hero.caption}</b>
          </div>
          <div className="duelo-hero-metrics">
            <DueloMetric label="Tiempo" value={formatClock(snapshot.elapsedMillis)} />
            <DueloMetric label="Restantes" value={snapshot.remainingTargets} />
            <DueloMetric label="Densidad" value={`${snapshot.fillPercent}%`} />
          </div>
        </section>

        <section className="duelo-player-grid" aria-label="Progreso de jugadores">
          {snapshot.playerProgress.map((player) => (
            <DueloPlayerCard
              key={player.index}
              leader={snapshot.leaderIndex === player.index}
              phase={snapshot.phase}
              player={player}
              ready={readyIndices.has(player.index)}
              recent={snapshot.recentClaim?.playerIndex === player.index}
              winner={snapshot.winnerIndex === player.index}
            />
          ))}
        </section>

        <footer className="duelo-event-rail">
          <span>{snapshot.phase === "waiting" ? "Preparación" : snapshot.phase === "finished" ? "Resultado" : "Último evento"}</span>
          <strong key={snapshot.motionEventId}>{snapshot.lastEventMessage || "Listo"}</strong>
          <b>{snapshot.phase === "finished" ? `Nueva partida en ${restartCountdown}` : `${snapshot.claimedTargets}/${snapshot.totalTargets} reclamadas`}</b>
        </footer>
      </div>
    </GameDisplayShell>
  );
}

function DueloPlayerCard({
  leader,
  phase,
  player,
  ready,
  recent,
  winner
}: {
  leader: boolean;
  phase: DueloSnapshot["phase"];
  player: DueloPlayerProgress;
  ready: boolean;
  recent: boolean;
  winner: boolean;
}) {
  const status = phase === "waiting"
    ? ready ? "Listo" : "Entra en tu zona"
    : phase === "starting"
      ? "Preparado"
      : winner
        ? "Ganador"
        : leader
          ? "Líder"
          : "En carrera";
  const style = {
    "--duelo-player": player.color,
    "--duelo-player-rgb": hexToRgb(player.color),
    "--duelo-progress": player.progress
  } as CSSProperties;
  const nameClass = player.label.length > 28 ? " is-extra-long" : player.label.length > 18 ? " is-long" : "";

  return (
    <article
      className={[
        "duelo-player-card",
        ready ? "is-ready" : "",
        leader ? "is-leader" : "",
        recent ? "is-recent" : "",
        winner ? "is-winner" : ""
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <header>
        <i aria-hidden="true" />
        <span className={`duelo-player-name${nameClass}`}>{player.label}</span>
        <b>{status}</b>
      </header>
      <div className="duelo-player-score">
        <strong>{player.remaining}</strong>
        <span>baldosas restantes</span>
        {recent ? <em key={`${player.index}-${player.claimed}`}>+1</em> : null}
      </div>
      <div className="duelo-player-track" aria-hidden="true"><i /></div>
      <footer>
        <span>Reclamadas</span>
        <strong>{player.claimed}/{player.target}</strong>
      </footer>
    </article>
  );
}

function DueloMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="duelo-hero-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function heroContent(snapshot: DueloSnapshot, countdown: number, restartCountdown: number) {
  if (snapshot.phase === "waiting") {
    return {
      eyebrow: `Listos ${snapshot.readyPlayers}/${snapshot.requiredPlayers}`,
      title: "Busca tu color",
      caption: "Cada jugador entra y permanece en su zona iluminada"
    };
  }
  if (snapshot.phase === "starting") {
    return {
      eyebrow: "Todos listos",
      title: String(countdown),
      caption: "El duelo está a punto de empezar"
    };
  }
  if (snapshot.phase === "finished") {
    return {
      eyebrow: "Victoria",
      title: `¡Gana ${snapshot.winnerLabel}!`,
      caption: `Nueva partida en ${restartCountdown}`
    };
  }
  return {
    eyebrow: snapshot.leaderIndex >= 0 ? `Lidera ${snapshot.leaderLabel}` : "Empate",
    title: "Reclama tu color",
    caption: "Pisa todas tus baldosas antes que los demás"
  };
}

function hexToRgb(color: HexColor): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "255, 255, 255";
  return [1, 3, 5]
    .map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
    .join(", ");
}
