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
          <MetricPanel label="Ready" tone="green" value={`${snapshot.activeTargets}/2`} />
          <MetricPanel label="Last" tone="magenta" value={lastValue} />
          <MetricPanel label="Time" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
        </MetricRow>

        <RoundStrip rounds={snapshot.rounds} totalRounds={totalRounds} />
      </div>
    </GameDisplayShell>
  );
}
