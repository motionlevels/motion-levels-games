import React from "react";
import { GameDisplayShell, MetricPanel, MetricRow, RoundStrip, VersusScoreboard } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { PingPongSnapshot } from "./game.ts";

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

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase} variant="versus">
      <div className="ping-pong-display ml-versus-display">
        <VersusScoreboard
          left={redPlayer}
          right={bluePlayer}
          target={target}
          centerLabel={centerLabel}
          centerValue={centerValue}
          centerCaption={centerCaption}
        />

        <MetricRow columns={4}>
          <MetricPanel label={rallyLabel} tone="cyan" value={rallyValue} />
          <MetricPanel label={progressLabel} tone={readyVisible ? "green" : "yellow"} value={progressValue} />
          <MetricPanel label="Último" tone={lastTone} value={lastValue} />
          <MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
        </MetricRow>

        <RoundStrip
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
