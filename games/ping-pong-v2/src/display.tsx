/** @jsxRuntime automatic */
import {
  DisplayStack,
  GameDisplayShell,
  MetricPanel,
  MetricRow,
  ResultOverlay,
  RoundStrip,
  TrajectoryLane,
  VersusScoreboard
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { PingPongBallPosition, PingPongSnapshot } from "./game.ts";

function trajectoryPoint(position: Pick<PingPongBallPosition, "x" | "y">) {
  return {
    x: position.y / 31,
    y: position.x / 15
  };
}

export function PlayerDisplay({
  snapshot
}: {
  snapshot: PingPongSnapshot;
  frame?: Frame;
}) {
  const [red, blue] = snapshot.players;
  const redPlayer = red ?? { label: "Rojo", score: 0, color: "#ff1c28" };
  const bluePlayer = blue ?? { label: "Azul", score: 0, color: "#145cff" };
  const target = Math.max(snapshot.matchTarget, 1);
  const totalRounds = target * 2 - 1;
  const centerLabel = snapshot.phase === "starting" ? "Empieza en" : "Objetivo";
  const centerValue = snapshot.phase === "starting" ? formatClock(snapshot.countdownMillis) : target;
  const centerCaption = snapshot.phase === "starting" ? "preparados" : "puntos para ganar";
  const rallyLabel = snapshot.phase === "finished" ? "Último peloteo" : "Peloteo";
  const rallyValue = snapshot.phase === "finished" && snapshot.lastRoundHits > 0
    ? snapshot.lastRoundHits
    : snapshot.roundHits;
  const lastValue = snapshot.lastRoundWinner || "-";
  const lastTone = lastValue === redPlayer.label
    ? "red"
    : lastValue === bluePlayer.label
      ? "blue"
      : "neutral";
  const readyVisible = snapshot.phase === "waiting" || snapshot.phase === "starting";
  const currentRound = Math.min(
    totalRounds,
    snapshot.rounds.length + (snapshot.phase === "running" || snapshot.phase === "starting" ? 1 : 0)
  );
  const progressLabel = readyVisible ? "Listos" : "Ronda";
  const progressValue = readyVisible ? `${snapshot.activeTargets}/2` : `${currentRound}/${totalRounds}`;
  const roundInProgress = snapshot.phase === "running";
  const activeRound = snapshot.phase === "finished"
    ? null
    : Math.min(totalRounds, snapshot.rounds.length + 1);
  const scorerLabel = snapshot.pointScorer === 0 ? redPlayer.label : bluePlayer.label;
  const winnerLabel = snapshot.winnerIndex === 0 ? redPlayer.label : bluePlayer.label;
  const rallyCaption = snapshot.phase === "waiting"
    ? `${snapshot.activeTargets}/2 en posición`
    : snapshot.phase === "starting"
      ? "Preparados"
      : snapshot.phase === "finished"
        ? `Victoria ${winnerLabel}`
        : snapshot.pointFlashMillis > 0
          ? `Punto ${scorerLabel}`
          : snapshot.roundHits > 0
            ? `${snapshot.roundHits} ${snapshot.roundHits === 1 ? "golpe" : "golpes"}`
            : "Saque";
  const direction = snapshot.phase === "running" ? snapshot.ball.dy < 0 ? "left" : "right" : "idle";
  const impact = snapshot.impact ? {
    position: trajectoryPoint(snapshot.impact),
    side: snapshot.impact.team === 0 ? "left" as const : "right" as const
  } : null;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase} variant="versus">
      <DisplayStack
        bottom={(
          <RoundStrip
            activeCaption={roundInProgress ? "Punto en curso" : "Por comenzar"}
            activeLabel={roundInProgress ? "En juego" : "Siguiente"}
            activeRound={activeRound}
            rounds={snapshot.rounds}
            totalRounds={totalRounds}
          />
        )}
        gap="compact"
        label="Marcador y trayectoria de Ping Pong"
        top={(
          <VersusScoreboard
            centerCaption={centerCaption}
            centerLabel={centerLabel}
            centerValue={centerValue}
            left={redPlayer}
            right={bluePlayer}
            target={target}
          />
        )}
      >
        <DisplayStack
          gap="compact"
          top={(
            <TrajectoryLane
              ariaLabel={`Trayectoria de la pelota: ${rallyCaption}`}
              caption={<strong key={`caption-${snapshot.motionEventId}`}>{rallyCaption}</strong>}
              direction={direction}
              impact={impact}
              left={{ color: redPlayer.color, label: redPlayer.label, value: redPlayer.score }}
              pace={snapshot.rallyPace}
              position={trajectoryPoint(snapshot.ball)}
              right={{ color: bluePlayer.color, label: bluePlayer.label, value: bluePlayer.score }}
              trail={snapshot.ballTrail.map(trajectoryPoint)}
            />
          )}
        >
          <MetricRow columns={4}>
            <MetricPanel label={rallyLabel} tone="cyan" value={rallyValue} />
            <MetricPanel label={progressLabel} tone={readyVisible ? "green" : "yellow"} value={progressValue} />
            <MetricPanel label="Último" tone={lastTone} value={lastValue} />
            <MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
          </MetricRow>
        </DisplayStack>
        <ResultOverlay
          message={`${redPlayer.score} – ${bluePlayer.score}`}
          title={`¡Gana ${winnerLabel}!`}
          tone={snapshot.winnerIndex === 0 ? "red" : "blue"}
          visible={snapshot.phase === "finished"}
        />
      </DisplayStack>
    </GameDisplayShell>
  );
}
