/** @jsxRuntime automatic */
import {
  DifficultyStars,
  DisplayStack,
  DisplayStage,
  EventRail,
  GameDisplayShell,
  IconStat,
  IconStatStrip,
  PlayerCard,
  PlayerReadyOverlay,
  PlayerRoster,
  ResultOverlay
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { MolePlayerProgress, WhackAMoleSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot }: { snapshot: WhackAMoleSnapshot; frame?: Frame }) {
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  const rows = Math.ceil(snapshot.playerCount / columns);
  const leaderIndex = uniqueLeaderIndex(snapshot.playerProgress);
  const winner = snapshot.winnerIndex >= 0 ? snapshot.playerProgress[snapshot.winnerIndex] : undefined;
  const leader = leaderIndex >= 0 ? snapshot.playerProgress[leaderIndex] : undefined;
  const readyIndices = new Set(
    snapshot.phase === "waiting" || snapshot.phase === "starting" ? snapshot.readyPlayerIndices : []
  );
  const restartCountdown = Math.max(1, Math.ceil(snapshot.remainingMillis / 1_000));
  const difficulty = snapshot.difficulty === "easy"
    ? { label: "Fácil", level: 1 }
    : { label: "Media", level: 2 };
  const summary = (
    <IconStatStrip label="Datos de la partida">
      <IconStat icon="target" label="Objetivo" tone="cyan" value="Tu color" />
      <IconStat icon="players" label="Jugadores" tone="magenta" value={snapshot.playerCount} />
      <DifficultyStars label={difficulty.label} level={difficulty.level} />
    </IconStatStrip>
  );
  const eventVisible = snapshot.phase === "running"
    && (snapshot.lastEventCue === "mole-hit" || snapshot.lastEventCue === "target-expired");

  return (
    <GameDisplayShell
      accent={winner?.color ?? leader?.color}
      phase={snapshot.phase}
      title={snapshot.label}
    >
      <DisplayStack
        bottom={eventVisible ? (
          <EventRail
            label="En directo"
            message={<span key={snapshot.motionEventId}>{snapshot.lastEventMessage}</span>}
            tone={snapshot.lastEventCue === "mole-hit" ? "cyan" : "neutral"}
          />
        ) : undefined}
        gap="compact"
        label="Marcador de Atrapa al topo"
        top={(
          <DisplayStage
            detail={summary}
            emphasis="strong"
            eyebrow={heroEyebrow(snapshot, leader)}
            headingLayout="status-right"
            title={heroTitle(snapshot)}
            tone="cyan"
          />
        )}
      >
        <PlayerRoster columns={columns} label="Puntuación de jugadores" rows={rows}>
          {snapshot.playerProgress.map((player) => (
            <MolePlayerCard
              key={player.index}
              leader={leaderIndex === player.index}
              phase={snapshot.phase}
              player={player}
              ready={readyIndices.has(player.index)}
              recent={snapshot.recentHitPlayerIndex === player.index}
              winner={snapshot.winnerIndex === player.index}
            />
          ))}
        </PlayerRoster>
        <ResultOverlay
          accent={winner?.color}
          eyebrow="Victoria"
          message={winner ? `${winner.score} puntos · ${winner.hits} ${winner.hits === 1 ? "topo" : "topos"}` : undefined}
          title={snapshot.winnerLabel}
          variant="victory"
          visible={snapshot.phase === "finished"}
        >
          <span>Nueva partida en {restartCountdown}</span>
        </ResultOverlay>
        {snapshot.phase === "starting" ? <PlayerReadyOverlay snapshot={snapshot} /> : null}
      </DisplayStack>
    </GameDisplayShell>
  );
}

function MolePlayerCard({
  leader,
  phase,
  player,
  ready,
  recent,
  winner
}: {
  leader: boolean;
  phase: WhackAMoleSnapshot["phase"];
  player: MolePlayerProgress;
  ready: boolean;
  recent: boolean;
  winner: boolean;
}) {
  const badge = winner
    ? "Ganador"
    : phase === "waiting"
      ? ready ? "✓ Listo" : undefined
      : leader ? "Líder" : undefined;
  return (
    <PlayerCard
      badge={badge}
      className={recent ? "is-recent" : ""}
      emphasis="score"
      featured={winner || leader || ready || recent}
      footer={`${player.hits} ${player.hits === 1 ? "topo atrapado" : "topos atrapados"}`}
      headingAlign="center"
      player={player}
      scoreUnit={player.score === 1 ? "punto" : "puntos"}
      state={ready ? "ready" : "default"}
      status={recent ? `+${player.lastPoints}` : "Puntos"}
    />
  );
}

function heroTitle(snapshot: WhackAMoleSnapshot): string {
  if (snapshot.phase === "waiting" || snapshot.phase === "starting") return "Busca tu color";
  if (snapshot.phase === "finished") return snapshot.winnerLabel;
  return formatClock(snapshot.remainingMillis);
}

function heroEyebrow(snapshot: WhackAMoleSnapshot, leader?: MolePlayerProgress): string {
  if (snapshot.phase === "waiting" || snapshot.phase === "starting") {
    return `${snapshot.readyPlayers}/${snapshot.requiredPlayers} colocados`;
  }
  if (snapshot.phase === "finished") return "Victoria";
  return leader ? `Lidera ${leader.label}` : "Todos contra todos";
}

function uniqueLeaderIndex(players: MolePlayerProgress[]): number {
  const bestScore = Math.max(0, ...players.map((player) => player.score));
  if (bestScore <= 0) return -1;
  const leaders = players.filter((player) => player.score === bestScore);
  return leaders.length === 1 ? leaders[0]!.index : -1;
}
