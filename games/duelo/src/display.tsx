/** @jsxRuntime automatic */
import {
  CountdownValue,
  DisplayStack,
  DisplayStage,
  EventRail,
  GameDisplayShell,
  IconStat,
  IconStatStrip,
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
  const hero = heroContent(snapshot, countdown);
  const winner = snapshot.winnerIndex >= 0 ? snapshot.playerProgress[snapshot.winnerIndex] : undefined;
  const leader = snapshot.leaderIndex >= 0 ? snapshot.playerProgress[snapshot.leaderIndex] : undefined;
  const summary = (
    <IconStatStrip label="Datos del duelo">
      <IconStat icon="clock" label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
      <IconStat icon="target" label="Objetivo" tone="cyan" value={snapshot.matchTarget} />
      <IconStat icon="players" label="Jugadores" tone="magenta" value={snapshot.playerCount} />
    </IconStatStrip>
  );
  const event = snapshot.phase === "running" && snapshot.lastEventMessage ? (
    <EventRail
      label="En directo"
      message={snapshot.lastEventMessage}
      tone="neutral"
    />
  ) : undefined;

  return (
    <GameDisplayShell
      accent={winner?.color ?? leader?.color}
      title={snapshot.label}
      phase={snapshot.phase}
    >
      <DisplayStack
        bottom={event}
        gap="compact"
        label="Progreso del duelo"
        top={(
          <DisplayStage
            detail={summary}
            emphasis="strong"
            eyebrow={hero.eyebrow}
            headingLayout="inline"
            label={snapshot.phase === "starting" ? "Cuenta atrás para comenzar" : undefined}
            title={hero.title}
            tone="cyan"
          />
        )}
      >
        <PlayerRoster columns={columns} label="Progreso de jugadores" rows={Math.ceil(snapshot.playerCount / columns)}>
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
          accent={winner?.color}
          eyebrow="Victoria"
          message={winner ? `${winner.claimed}/${winner.target} baldosas pisadas` : undefined}
          title={snapshot.winnerLabel}
          variant="victory"
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
    ? ready ? "Listo" : undefined
    : winner
      ? "Ganador"
      : leader
        ? "Líder"
        : undefined;
  return (
    <PlayerCard
      badge={status}
      className={recent ? "is-recent" : ""}
      emphasis="score"
      featured={winner || leader || ready}
      footer={(
        <ProgressMeter
          ariaValueText={`${player.claimed} de ${player.target} baldosas pisadas`}
          label="Pisadas"
          max={player.target}
          tone="cyan"
          value={player.claimed}
          valueLabel={`${player.claimed}/${player.target}`}
        />
      )}
      player={{ color: player.color, label: player.label, score: player.remaining }}
      scoreUnit={player.remaining === 1 ? "baldosa restante" : "baldosas restantes"}
      status={player.remaining === 1 ? "Restante" : "Restantes"}
    />
  );
}

function heroContent(snapshot: DueloSnapshot, countdown: number) {
  if (snapshot.phase === "waiting") {
    return {
      eyebrow: `${snapshot.readyPlayers}/${snapshot.requiredPlayers} colocados`,
      title: "Busca tu color"
    };
  }
  if (snapshot.phase === "starting") {
    return {
      eyebrow: "Todos listos",
      title: <CountdownValue label="Comienza en" value={countdown} />
    };
  }
  if (snapshot.phase === "finished") {
    return {
      eyebrow: "Victoria",
      title: `¡Gana ${snapshot.winnerLabel}!`
    };
  }
  return {
    eyebrow: snapshot.leaderIndex >= 0 ? `Lidera ${snapshot.leaderLabel}` : "Empate",
    title: "Pisa tu color"
  };
}
