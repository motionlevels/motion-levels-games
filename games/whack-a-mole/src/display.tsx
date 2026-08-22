/** @jsxRuntime automatic */
import {
  DisplayStack,
  DisplayStage,
  EventRail,
  GameDisplayShell,
  MetricPanel,
  MetricRow,
  PlayerCard as DisplayPlayerCard,
  PlayerRoster,
  ResultOverlay
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { MolePlayerProgress, WhackAMoleSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot }: { snapshot: WhackAMoleSnapshot; frame?: Frame }) {
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  const leader = snapshot.playerProgress.reduce(
    (best, player) => player.score > (snapshot.playerProgress[best]?.score ?? -1) ? player.index : best,
    0
  );
  const hero = heroContent(snapshot);
  const eventDetail = snapshot.phase === "running"
    ? `${snapshot.activeTargets} objetivos activos`
    : `${snapshot.readyPlayers}/${snapshot.requiredPlayers} listos`;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <DisplayStack
        bottom={(
          <EventRail
            detail={eventDetail}
            label={snapshot.phase === "finished" ? "Resultado" : "Último evento"}
            message={<span key={snapshot.motionEventId}>{snapshot.lastEventMessage}</span>}
            tone={snapshot.phase === "finished" ? "green" : "cyan"}
          />
        )}
        label="Marcador de Atrapa el Topo"
        top={(
          <DisplayStage detail={hero.caption} eyebrow={hero.eyebrow} title={hero.title} tone="cyan">
            <MetricRow columns={3}>
              <MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.remainingMillis)} />
              <MetricPanel label="Topos" tone="yellow" value={snapshot.activeTargets} />
              <MetricPanel label="Puntos" tone="cyan" value={snapshot.score} />
            </MetricRow>
          </DisplayStage>
        )}
      >
        <PlayerRoster columns={columns} label="Puntuación de jugadores">
          {snapshot.playerProgress.map((player) => (
            <MolePlayerCard
              key={player.index}
              leader={leader === player.index}
              player={player}
              ready={snapshot.readyPlayerIndices.includes(player.index)}
              winner={snapshot.winnerIndex === player.index}
            />
          ))}
        </PlayerRoster>
        <ResultOverlay
          message="Más velocidad, más puntos"
          title={`¡Gana ${snapshot.winnerLabel}!`}
          tone="green"
          visible={snapshot.phase === "finished"}
        />
      </DisplayStack>
    </GameDisplayShell>
  );
}

function MolePlayerCard({
  player,
  leader,
  ready,
  winner
}: {
  player: MolePlayerProgress;
  leader: boolean;
  ready: boolean;
  winner: boolean;
}) {
  const badge = winner ? "Ganador" : leader && player.score > 0 ? "Líder" : ready ? "Listo" : "Busca tu color";
  const scoreStatus = player.lastPoints > 0 ? `+${player.lastPoints} puntos` : "puntos";

  return (
    <DisplayPlayerCard
      badge={badge}
      featured={winner || leader}
      footer={`Topos atrapados · ${player.hits}`}
      player={player}
      status={scoreStatus}
    />
  );
}

function heroContent(snapshot: WhackAMoleSnapshot) {
  if (snapshot.phase === "waiting") {
    return {
      eyebrow: `Listos ${snapshot.readyPlayers}/${snapshot.requiredPlayers}`,
      title: "Busca tu plataforma",
      caption: "Cada jugador permanece sobre su color"
    };
  }
  if (snapshot.phase === "starting") {
    return {
      eyebrow: "Todos listos",
      title: String(Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000))),
      caption: "Los topos están a punto de aparecer"
    };
  }
  if (snapshot.phase === "finished") {
    return { eyebrow: "Tiempo", title: `¡Gana ${snapshot.winnerLabel}!`, caption: "Más velocidad, más puntos" };
  }
  return {
    eyebrow: "Todos contra todos",
    title: "¡Atrapa los topos!",
    caption: "Corre hacia los cuadrados de colores antes de que se apaguen"
  };
}
