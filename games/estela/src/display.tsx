/** @jsxRuntime automatic */
import {
  DisplayStack,
  DisplayStage,
  EventRail,
  GameDisplayShell,
  MetricPanel,
  MetricRow,
  PlayerCard as DisplayPlayerCard,
  PlayerReadyOverlay,
  PlayerRoster,
  ProgressMeter,
  ResultOverlay
} from "@motion-levels-games/display-kit";
import type { Frame } from "@motion-levels-games/game-sdk";
import type { EstelaPlayerProgress, EstelaSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot }: { snapshot: EstelaSnapshot; frame?: Frame }) {
  const hero = heroContent(snapshot);
  const shellPhase = snapshot.phase === "round-win" ? "running" : snapshot.phase;
  const winner = snapshot.gameWinnerIndex >= 0 ? snapshot.playerProgress[snapshot.gameWinnerIndex] : undefined;
  const roundWinner = snapshot.roundWinnerIndex >= 0 ? snapshot.playerProgress[snapshot.roundWinnerIndex] : undefined;
  const columns = snapshot.playerCount <= 4 ? 2 : snapshot.playerCount <= 6 ? 3 : 4;
  const eventLabel = snapshot.phase === "round-win"
    ? "Ronda ganada"
    : snapshot.phase === "finished"
      ? "Resultado"
      : "Último evento";

  return (
    <GameDisplayShell title={snapshot.label} phase={shellPhase}>
      <DisplayStack
        bottom={(
          <EventRail
            detail={`Primero en ganar ${snapshot.roundsToWin} rondas`}
            label={eventLabel}
            message={snapshot.lastEventMessage || "La pista está preparada"}
            tone={snapshot.phase === "finished" ? "magenta" : "cyan"}
          />
        )}
        className={`estela-display is-phase-${snapshot.phase}`}
        label="Carrera de Estela"
        top={(
          <DisplayStage detail={hero.caption} eyebrow={hero.eyebrow} title={hero.title} tone="cyan">
            <MetricRow columns={3}>
              <MetricPanel label="Ronda" tone="cyan" value={snapshot.currentRound} />
              <MetricPanel label="En pie" tone="green" value={`${snapshot.activeTargets}/${snapshot.playerCount}`} />
              <MetricPanel label="Cierre" tone="red" value={snapshot.arenaInset} />
            </MetricRow>
          </DisplayStage>
        )}
      >
        <PlayerRoster columns={columns} label="Progreso de jugadores en Estela">
          {snapshot.playerProgress.map((player) => (
            <EstelaPlayerCard
              gameWinner={snapshot.gameWinnerIndex === player.index}
              key={player.index}
              phase={snapshot.phase}
              player={player}
              roundWinner={snapshot.roundWinnerIndex === player.index}
              target={snapshot.roundsToWin}
            />
          ))}
        </PlayerRoster>
        <ResultOverlay
          className="estela-result is-round-win"
          eyebrow={`Ronda ${snapshot.currentRound}`}
          message="La siguiente ronda empieza en breve"
          title={roundWinner ? `Ronda para ${roundWinner.label}` : "Ronda completada"}
          tone="cyan"
          visible={snapshot.phase === "round-win"}
        />
        <ResultOverlay
          className="estela-result is-game-win"
          eyebrow="Victoria"
          message={winner ? `${winner.roundWins} rondas ganadas` : `${snapshot.roundsToWin} rondas ganadas`}
          title={winner ? `¡Gana ${winner.label}!` : "¡Victoria!"}
          tone="magenta"
          visible={snapshot.phase === "finished"}
        />
      </DisplayStack>
      <PlayerReadyOverlay snapshot={snapshot} />
    </GameDisplayShell>
  );
}

function EstelaPlayerCard({
  gameWinner,
  phase,
  player,
  roundWinner,
  target
}: {
  gameWinner: boolean;
  phase: EstelaSnapshot["phase"];
  player: EstelaPlayerProgress;
  roundWinner: boolean;
  target: number;
}) {
  const badge = gameWinner
    ? "Ganador"
    : roundWinner
      ? "Gana la ronda"
      : !player.alive
        ? "Eliminado"
        : phase === "waiting"
          ? "Busca tu color"
          : phase === "starting"
            ? "Preparado"
            : "En juego";
  const classes = `${player.alive ? "" : " is-eliminated"}${roundWinner ? " is-round-winner" : ""}${gameWinner ? " is-game-winner" : ""}`;

  return (
    <DisplayPlayerCard
      badge={badge}
      className={`estela-player-card${classes}`}
      featured={roundWinner || gameWinner}
      footer={(
        <div className="estela-card-footer">
          <ProgressMeter
            ariaValueText={`${player.roundWins} de ${target} rondas ganadas`}
            className="estela-round-progress"
            label="Rondas ganadas"
            max={target}
            tone="neutral"
            value={player.roundWins}
            valueLabel={`${player.roundWins}/${target}`}
          />
          <span className="estela-trail-stat">Longitud de estela <strong>{player.trailLength}</strong></span>
        </div>
      )}
      player={{ color: player.color, label: player.label, score: player.roundWins }}
      scoreUnit="rondas ganadas"
      status="rondas ganadas"
    />
  );
}

function heroContent(snapshot: EstelaSnapshot) {
  if (snapshot.phase === "waiting") return { eyebrow: `Listos ${snapshot.readyPlayers}/${snapshot.requiredPlayers}`, title: "Busca tu color", caption: "Cada jugador permanece en su plataforma" };
  if (snapshot.phase === "starting") return { eyebrow: "Todos listos", title: String(Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000))), caption: "Prepara tu primera dirección" };
  if (snapshot.phase === "round-win") return { eyebrow: `Ronda ${snapshot.currentRound}`, title: "Último en pie", caption: "Las estelas se reinician para la siguiente ronda" };
  if (snapshot.phase === "finished") return { eyebrow: "Partida terminada", title: "Victoria", caption: "La luz más resistente domina la pista" };
  return { eyebrow: `Ronda ${snapshot.currentRound}`, title: "¡No cruces las estelas!", caption: "El borde rojo se acerca durante la ronda" };
}
