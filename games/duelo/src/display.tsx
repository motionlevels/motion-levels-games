/** @jsxRuntime automatic */
import {
  DisplayStack,
  DisplayStage,
  EventRail,
  GameDisplayShell,
  MetricPanel,
  MetricRow,
  PlayerCard,
  PlayerRoster,
  ProgressMeter,
  ResultOverlay
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
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
  const winner = snapshot.winnerIndex >= 0 ? snapshot.playerProgress[snapshot.winnerIndex] : undefined;
  const heroMetrics = (
    <MetricRow columns={3}>
      <MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
      <MetricPanel label="Objetivo" tone="cyan" value={snapshot.matchTarget} />
      <MetricPanel label="Jugadores" tone="magenta" value={snapshot.playerCount} />
    </MetricRow>
  );
  const event = (
    <EventRail
      detail={snapshot.phase === "finished" ? `Nueva partida en ${restartCountdown}` : `${snapshot.claimedTargets}/${snapshot.totalTargets} reclamadas`}
      label={snapshot.phase === "waiting" ? "Preparación" : snapshot.phase === "finished" ? "Resultado" : "Último evento"}
      message={snapshot.lastEventMessage || "Listo"}
      tone={snapshot.phase === "finished" ? "green" : "cyan"}
    />
  );

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <DisplayStack
        bottom={event}
        label="Progreso del duelo"
        top={<DisplayStage detail={hero.caption} eyebrow={hero.eyebrow} title={hero.title} tone="cyan">{heroMetrics}</DisplayStage>}
      >
        <PlayerRoster columns={columns} label="Progreso de jugadores">
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
        </PlayerRoster>
        <ResultOverlay
          message={winner ? `${winner.claimed}/${winner.target} baldosas reclamadas` : undefined}
          title={`¡Gana ${snapshot.winnerLabel}!`}
          tone="green"
          visible={snapshot.phase === "finished"}
        >
          <span>Nueva partida en {restartCountdown}</span>
        </ResultOverlay>
      </DisplayStack>
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
  return (
    <PlayerCard
      badge={status}
      className={recent ? "is-recent" : ""}
      featured={winner || leader || ready}
      footer={(
        <ProgressMeter
          ariaValueText={`${player.claimed} de ${player.target} baldosas reclamadas`}
          label="Reclamadas"
          max={player.target}
          tone="cyan"
          value={player.claimed}
          valueLabel={`${player.claimed}/${player.target}`}
        />
      )}
      player={{ color: player.color, label: player.label, score: player.remaining }}
      scoreUnit="baldosas restantes"
      status={recent ? "baldosas restantes · +1" : "baldosas restantes"}
    />
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
