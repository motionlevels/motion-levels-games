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
  const target = Math.max(snapshot.matchTarget, 1);
  const totalRounds = target * 2 - 1;
  const centerLabel = snapshot.phase === "starting" ? "Starts in" : "Target";
  const centerValue = snapshot.phase === "starting" ? formatClock(snapshot.countdownMillis) : target;
  const centerCaption = snapshot.phase === "starting" ? "get ready" : "points to win";
  const rallyLabel = snapshot.phase === "finished" ? "Last rally" : "Rally";
  const rallyValue = snapshot.phase === "finished" && snapshot.lastRoundHits > 0
    ? snapshot.lastRoundHits
    : snapshot.roundHits;
  const lastValue = snapshot.lastRoundWinner || "-";
  const readyVisible = snapshot.phase === "waiting" || snapshot.phase === "starting";
  const currentRound = Math.min(
    totalRounds,
    snapshot.rounds.length + (snapshot.phase === "running" || snapshot.phase === "starting" ? 1 : 0)
  );
  const progressLabel = readyVisible ? "Ready" : "Round";
  const progressValue = readyVisible ? `${snapshot.activeTargets}/2` : `${currentRound}/${totalRounds}`;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase} variant="versus">
      <div className="ping-pong-display ml-versus-display">
        <VersusScoreboard
          left={red ?? { label: "Rojo", score: 0, color: "#ff1c28" }}
          right={blue ?? { label: "Azul", score: 0, color: "#145cff" }}
          target={target}
          centerLabel={centerLabel}
          centerValue={centerValue}
          centerCaption={centerCaption}
        />

        <MetricRow columns={4}>
          <MetricPanel label={rallyLabel} tone="cyan" value={rallyValue} />
          <MetricPanel label={progressLabel} tone={readyVisible ? "green" : "yellow"} value={progressValue} />
          <MetricPanel label="Last" tone="magenta" value={lastValue} />
          <MetricPanel label="Time" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
        </MetricRow>

        <RoundStrip rounds={snapshot.rounds} totalRounds={totalRounds} />
      </div>
    </GameDisplayShell>
  );
}
