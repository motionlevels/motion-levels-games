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
  const centerLabel = snapshot.phase === "starting" ? "Starts in" : "Rally";
  const centerValue = snapshot.phase === "starting" ? formatClock(snapshot.countdownMillis) : snapshot.roundHits;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase} variant="versus">
      <div className="ping-pong-display ml-versus-display">
        <VersusScoreboard
          left={red ?? { label: "Rojo", score: 0, color: "#ff1c28" }}
          right={blue ?? { label: "Azul", score: 0, color: "#145cff" }}
          target={target}
          centerLabel={centerLabel}
          centerValue={centerValue}
          centerCaption={`${target} points to win`}
        />

        <MetricRow columns={3}>
          <MetricPanel label="Target" tone="amber" value={target} />
          <MetricPanel label="Ready" tone="green" value={`${snapshot.activeTargets}/2`} />
          <MetricPanel label="Last" tone="magenta" value={snapshot.lastRoundWinner || "-"} />
        </MetricRow>

        <RoundStrip rounds={snapshot.rounds} />
      </div>
    </GameDisplayShell>
  );
}
