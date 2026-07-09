import React from "react";
import type { CSSProperties } from "react";
import { GameDisplayShell, MetricPanel, MetricRow, RoundStrip, VersusScoreboard } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { PingPongBallPosition, PingPongSnapshot } from "./game.ts";

function positionStyle(position: PingPongBallPosition): CSSProperties {
  return {
    "--ping-pong-ball-x": `${3.5 + (position.y / 31) * 93}%`,
    "--ping-pong-ball-y": `${18 + (position.x / 15) * 64}%`
  } as CSSProperties;
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
  const scoringSide = snapshot.pointScorer === 0 ? "red" : snapshot.pointScorer === 1 ? "blue" : "none";
  const winnerSide = snapshot.winnerIndex === 0 ? "red" : snapshot.winnerIndex === 1 ? "blue" : "none";
  const displayClassName = [
    "ping-pong-display",
    "ml-versus-display",
    `is-phase-${snapshot.phase}`,
    snapshot.pointFlashMillis > 0 ? `is-scoring-${scoringSide}` : "",
    snapshot.phase === "finished" ? `is-winner-${winnerSide}` : ""
  ].filter(Boolean).join(" ");
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
  const impactStyle = snapshot.impact ? positionStyle(snapshot.impact) : undefined;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase} variant="versus">
      <div
        className={displayClassName}
        style={{ "--ping-pong-rally-pace": snapshot.rallyPace } as CSSProperties}
      >
        <VersusScoreboard
          className="ping-pong-scoreboard"
          left={redPlayer}
          right={bluePlayer}
          target={target}
          centerLabel={centerLabel}
          centerValue={centerValue}
          centerCaption={centerCaption}
        />

        <section
          aria-label={`Trayectoria de la pelota: ${rallyCaption}`}
          className="ping-pong-rally-lane"
        >
          <span className="ping-pong-rally-team is-red">Rojo</span>
          <span className="ping-pong-rally-team is-blue">Azul</span>
          <span className="ping-pong-rally-net" aria-hidden="true" />
          <span className="ping-pong-rally-scan" aria-hidden="true" />
          {snapshot.ballTrail.map((position, index) => (
            <i
              aria-hidden="true"
              className="ping-pong-ball-trail"
              key={`${index}-${position.x}-${position.y}`}
              style={{ ...positionStyle(position), "--ping-pong-trail-index": index } as CSSProperties}
            />
          ))}
          <i
            aria-hidden="true"
            className="ping-pong-ball"
            style={positionStyle(snapshot.ball)}
          />
          {snapshot.impact ? (
            <i
              aria-hidden="true"
              className={`ping-pong-impact is-${snapshot.impact.team === 0 ? "red" : "blue"}`}
              key={snapshot.motionEventId}
              style={impactStyle}
            />
          ) : null}
          <strong className="ping-pong-rally-caption" key={`caption-${snapshot.motionEventId}`}>
            {rallyCaption}
          </strong>
        </section>

        <MetricRow columns={4} className="ping-pong-metrics">
          <MetricPanel className="ping-pong-rally-metric" label={rallyLabel} tone="cyan" value={rallyValue} />
          <MetricPanel className="ping-pong-progress-metric" label={progressLabel} tone={readyVisible ? "green" : "yellow"} value={progressValue} />
          <MetricPanel className="ping-pong-last-metric" label="Último" tone={lastTone} value={lastValue} />
          <MetricPanel className="ping-pong-time-metric" label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
        </MetricRow>

        <RoundStrip
          className="ping-pong-rounds"
          activeCaption={roundInProgress ? "Punto en curso" : "Por comenzar"}
          activeLabel={roundInProgress ? "En juego" : "Siguiente"}
          activeRound={activeRound}
          rounds={snapshot.rounds}
          totalRounds={totalRounds}
        />
      </div>
    </GameDisplayShell>
  );
}
