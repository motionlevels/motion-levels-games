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
import type { MemoryChallengeSnapshot, MemoryPlayerProgress } from "./game.ts";

export function PlayerDisplay({ snapshot }: { snapshot: MemoryChallengeSnapshot; frame?: Frame }) {
  const countdown = Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000));
  const hero = heroContent(snapshot, countdown);
  const winner = snapshot.winnerIndex >= 0;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <DisplayStack
        bottom={(
          <EventRail
            detail={snapshot.phase === "running" ? stageLabel(snapshot) : `${snapshot.readyPlayers}/${snapshot.requiredPlayers} listos`}
            label={snapshot.phase === "finished" ? "Resultado" : "Último evento"}
            message={<span key={snapshot.motionEventId}>{snapshot.lastEventMessage}</span>}
            tone={snapshot.memoryStage === "memorize" ? "magenta" : "cyan"}
          />
        )}
        label="Carrera de memoria"
        top={(
          <DisplayStage detail={hero.caption} eyebrow={hero.eyebrow} title={hero.title} tone="magenta">
            <MetricRow columns={2}>
              <MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.remainingMillis)} />
              <MetricPanel label="Mejor camino" tone="cyan" value={snapshot.score} />
            </MetricRow>
          </DisplayStage>
        )}
      >
        <PlayerRoster columns={Math.min(4, Math.max(1, snapshot.playerCount))} label="Progreso de jugadores">
          {snapshot.playerProgress.map((player) => (
            <MemoryPlayerCard
              key={player.index}
              player={player}
              ready={snapshot.readyPlayerIndices.includes(player.index)}
              winner={snapshot.winnerIndex === player.index}
            />
          ))}
        </PlayerRoster>
        <ResultOverlay
          eyebrow={winner ? "Camino completado" : "Tiempo agotado"}
          message={winner ? "La ruta vencedora vuelve a iluminarse" : "Nueva carrera en unos segundos"}
          title={winner ? `¡Gana ${snapshot.winnerLabel}!` : "La lava gana"}
          tone={winner ? "green" : "red"}
          visible={snapshot.phase === "finished"}
        />
      </DisplayStack>
    </GameDisplayShell>
  );
}

function MemoryPlayerCard({
  player,
  ready,
  winner
}: {
  player: MemoryPlayerProgress;
  ready: boolean;
  winner: boolean;
}) {
  const progress = player.pathLength === 0 ? 0 : player.bestProgress / player.pathLength;
  const badge = winner
    ? "Ganador"
    : player.status === "failed"
      ? "Vuelve al inicio"
      : player.status === "memorizing"
        ? "Memoriza"
        : ready
          ? "Listo"
          : "En carrera";

  return (
    <DisplayPlayerCard
      badge={badge}
      className={player.status === "failed" ? "is-muted" : ""}
      featured={winner}
      footer={`Avance actual · ${Math.round(progress * 100)}%`}
      player={{ color: player.color, label: player.label, score: player.bestProgress }}
      scoreUnit="baldosas"
      status={`de ${player.pathLength} baldosas`}
      target={player.pathLength}
    />
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
